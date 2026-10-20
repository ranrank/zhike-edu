/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.nageoffer.ai.ragent.mcp.campus;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.time.LocalDate;
import java.util.List;

import static com.nageoffer.ai.ragent.mcp.campus.CampusModels.*;

/** 复用现有 JDBC，所有个人数据查询显式绑定调用链传入的登录用户。 */
public class CampusRepository {
    private final JdbcTemplate jdbc;

    public CampusRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final RowMapper<Student> STUDENT = (r, n) -> new Student(r.getString("user_id"),
            r.getString("college"), r.getString("major"), r.getInt("study_year"),
            r.getString("plan_version"), r.getBigDecimal("completed_credits"), r.getString("student_status"));
    private static final RowMapper<Course> COURSE = (r, n) -> new Course(r.getString("course_code"),
            r.getString("name"), r.getString("semester"), r.getBigDecimal("credits"),
            r.getInt("remaining_seats"), r.getBoolean("selection_open"));
    private static final RowMapper<Rule> RULE = (r, n) -> new Rule(r.getString("rule_id"),
            r.getString("course_code"), r.getString("major"), r.getString("plan_version"),
            r.getInt("min_year"), r.getInt("max_year"), r.getBigDecimal("min_credits"),
            r.getString("prerequisite_course_code"), r.getString("source_title"),
            r.getString("source_section"), r.getString("rule_text"),
            r.getDate("valid_from").toLocalDate(), r.getDate("valid_until").toLocalDate());
    private static final RowMapper<Enrollment> ENROLLMENT = (r, n) -> new Enrollment(
            r.getString("enrollment_id"), r.getString("user_id"), r.getString("course_code"),
            r.getString("semester"), r.getString("enrollment_type"));
    private static final RowMapper<LeaveApplication> LEAVE = (r, n) -> new LeaveApplication(
            r.getString("application_id"), r.getString("user_id"), r.getString("request_id"),
            r.getDate("start_date").toLocalDate(), r.getDate("end_date").toLocalDate(),
            r.getString("reason"), r.getString("status"));

    public Student student(String userId, boolean lock) {
        return first(jdbc.query("SELECT * FROM campus_student WHERE user_id = ?" +
                (lock ? " FOR UPDATE" : ""), STUDENT, userId));
    }

    public Course course(String code, boolean lock) {
        return first(jdbc.query("SELECT * FROM campus_course WHERE course_code = ?" +
                (lock ? " FOR UPDATE" : ""), COURSE, code));
    }

    public List<Rule> rules(Student student, String courseCode, LocalDate date) {
        return jdbc.query("""
                SELECT * FROM campus_course_rule
                WHERE major = ? AND plan_version = ? AND course_code = ?
                  AND valid_from <= ? AND valid_until >= ? ORDER BY rule_id
                """, RULE, student.major(), student.planVersion(), courseCode, date, date);
    }

    public String courseResult(String userId, String courseCode) {
        return first(jdbc.query("SELECT result FROM campus_transcript WHERE user_id = ? AND course_code = ?",
                (r, n) -> r.getString(1), userId, courseCode));
    }

    public List<String> passedCourses(String userId) {
        return jdbc.query("SELECT course_code FROM campus_transcript WHERE user_id = ? AND result = 'PASSED' ORDER BY course_code",
                (r, n) -> r.getString(1), userId);
    }

    public Enrollment enrollment(String userId, Course course) {
        return first(jdbc.query("SELECT * FROM campus_enrollment WHERE user_id = ? AND course_code = ? AND semester = ?",
                ENROLLMENT, userId, course.code(), course.semester()));
    }

    public void insertEnrollment(Enrollment enrollment, String ruleId) {
        jdbc.update("""
                INSERT INTO campus_enrollment(enrollment_id,user_id,course_code,semester,enrollment_type,rule_id)
                VALUES (?,?,?,?,?,?)
                """, enrollment.id(), enrollment.userId(), enrollment.courseCode(), enrollment.semester(),
                enrollment.type(), ruleId);
        int changed = jdbc.update("UPDATE campus_course SET remaining_seats = remaining_seats - 1 WHERE course_code = ? AND remaining_seats > 0",
                enrollment.courseCode());
        if (changed != 1) {
            throw new IllegalStateException("Course capacity changed inside locked transaction");
        }
    }

    public LeaveApplication leave(String userId, String requestId) {
        return first(jdbc.query("SELECT * FROM campus_leave_application WHERE user_id = ? AND request_id = ?",
                LEAVE, userId, requestId));
    }

    public void insertLeave(LeaveApplication leave) {
        jdbc.update("""
                INSERT INTO campus_leave_application(application_id,user_id,request_id,start_date,end_date,reason)
                VALUES (?,?,?,?,?,?)
                """, leave.id(), leave.userId(), leave.requestId(), leave.startDate(), leave.endDate(), leave.reason());
    }

    private static <T> T first(List<T> values) {
        return values.isEmpty() ? null : values.get(0);
    }
}
