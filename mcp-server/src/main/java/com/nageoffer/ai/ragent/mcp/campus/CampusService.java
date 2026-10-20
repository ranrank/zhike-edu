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

import com.nageoffer.ai.ragent.mcp.executor.McpToolException;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static com.nageoffer.ai.ragent.mcp.campus.CampusModels.*;

public class CampusService {
    private final CampusRepository repository;
    private final TransactionTemplate transactions;
    private final Clock clock;

    public CampusService(CampusRepository repository, TransactionTemplate transactions, Clock clock) {
        this.repository = repository;
        this.transactions = transactions;
        this.clock = clock;
    }

    public Student profile(String userId) {
        return requireStudent(userId, false);
    }

    public List<String> passedCourses(String userId) {
        requireStudent(userId, false);
        return repository.passedCourses(userId);
    }

    public List<Rule> rules(String userId, String code) {
        Student student = requireStudent(userId, false);
        requireCourse(code, false);
        return repository.rules(student, code, LocalDate.now(clock));
    }

    public Eligibility check(String userId, String code) {
        return evaluate(requireStudent(userId, false), requireCourse(code, false));
    }

    private Eligibility evaluate(Student student, Course course) {
        List<Rule> rules = repository.rules(student, course.code(), LocalDate.now(clock));
        if (rules.size() != 1) {
            return new Eligibility("UNKNOWN", student, course, null, List.of(rules.isEmpty()
                    ? "未找到与当前专业、培养方案版本和有效期匹配的规则，暂不能判断；请联系教务确认"
                    : "匹配到多条有效规则，存在冲突，暂不能判断；请联系教务确认"));
        }
        Rule rule = rules.get(0);
        List<String> reasons = new ArrayList<>();
        if (!"ACTIVE".equals(student.status())) {
            reasons.add("当前学籍不是在读状态");
        }
        if (student.studyYear() < rule.minYear() || student.studyYear() > rule.maxYear()) {
            reasons.add("当前为第 " + student.studyYear() + " 学年，规则要求第 " + rule.minYear() + " 至 " + rule.maxYear() + " 学年");
        }
        if (student.completedCredits().compareTo(rule.minCredits()) < 0) {
            reasons.add("已修 " + student.completedCredits() + " 学分，至少需要 " + rule.minCredits() + " 学分");
        }
        if (rule.prerequisite() != null && !"PASSED".equals(repository.courseResult(student.userId(), rule.prerequisite()))) {
            reasons.add("尚未通过先修课程 " + rule.prerequisite());
        }
        if ("PASSED".equals(repository.courseResult(student.userId(), course.code()))) {
            reasons.add("已通过该课程，不能重复选修");
        }
        if (!course.selectionOpen()) {
            reasons.add("该课程当前不在选课开放期");
        }
        if (course.remainingSeats() <= 0) {
            reasons.add("课程剩余名额为 0");
        }
        if (repository.enrollment(student.userId(), course) != null) {
            reasons.add("本学期已报名该课程，无需重复报名");
        }
        return new Eligibility(reasons.isEmpty() ? "ELIGIBLE" : "INELIGIBLE", student, course, rule,
                reasons.isEmpty() ? List.of("满足当前版本规则；提交前将再次校验状态、规则与名额") : List.copyOf(reasons));
    }

    /** 用户行锁串行化个人写入，课程行锁避免最后一个名额被并发占用。确认后必须重新判断。 */
    public Enrollment enroll(String userId, String code, boolean retake) {
        return transactions.execute(status -> {
            Student student = requireStudent(userId, true);
            Course course = requireCourse(code, true);
            String type = retake ? "RETAKE" : "NORMAL";
            Enrollment existing = repository.enrollment(userId, course);
            if (existing != null) {
                if (!type.equals(existing.type())) {
                    throw new McpToolException("本学期已用另一种方式报名该课程，请先联系教务核实");
                }
                return existing;
            }
            Eligibility decision = evaluate(student, course);
            if (!decision.eligible()) {
                throw new McpToolException(String.join("；", decision.reasons()));
            }
            String result = repository.courseResult(userId, code);
            if (retake && !"FAILED".equals(result)) {
                throw new McpToolException("没有该课程的未通过记录，不能按重修报名");
            }
            if (!retake && "FAILED".equals(result)) {
                throw new McpToolException("该课程已有未通过记录，请使用重修报名");
            }
            Enrollment enrollment = new Enrollment(UUID.randomUUID().toString(), userId, code, course.semester(), type);
            repository.insertEnrollment(enrollment, decision.rule().id());
            return enrollment;
        });
    }

    public LeaveApplication applyLeave(String userId, String requestId, LocalDate start, LocalDate end, String reason) {
        if (requestId == null || !requestId.matches("[A-Za-z0-9_-]{1,64}")) {
            throw new McpToolException("申请标识须为 1 至 64 位字母、数字、下划线或短横线，同一次申请重试时保持一致");
        }
        if (start == null || end == null || end.isBefore(start) || start.isBefore(LocalDate.now(clock))
                || ChronoUnit.DAYS.between(start, end) >= 7) {
            throw new McpToolException("演示流程支持从今天或未来开始、包含起止日在内不超过 7 天的请假，请检查日期");
        }
        String normalizedReason = reason == null ? "" : reason.strip();
        if (normalizedReason.isEmpty() || normalizedReason.length() > 500) {
            throw new McpToolException("请填写 1 至 500 字的请假事由");
        }
        return transactions.execute(status -> {
            Student student = requireStudent(userId, true);
            LeaveApplication existing = repository.leave(userId, requestId);
            if (existing != null) {
                if (!existing.startDate().equals(start) || !existing.endDate().equals(end)
                        || !existing.reason().equals(normalizedReason)) {
                    throw new McpToolException("该申请标识已用于不同内容；修改申请内容需使用新的申请标识");
                }
                return existing;
            }
            if (!"ACTIVE".equals(student.status())) {
                throw new McpToolException("当前学籍不是在读状态，暂不能提交请假");
            }
            LeaveApplication leave = new LeaveApplication(UUID.randomUUID().toString(), userId, requestId,
                    start, end, normalizedReason, "PENDING");
            repository.insertLeave(leave);
            return leave;
        });
    }

    private Student requireStudent(String userId, boolean lock) {
        if (userId == null || userId.isBlank()) {
            throw new McpToolException("系统暂时无法确认你的身份，本次没有执行");
        }
        Student student = repository.student(userId, lock);
        if (student == null) {
            throw new McpToolException("当前账号未绑定学生档案，请联系教务完成绑定，不能用对话中自报的信息替代");
        }
        return student;
    }

    private Course requireCourse(String code, boolean lock) {
        if (code == null || code.isBlank() || code.length() > 32) {
            throw new McpToolException("请提供有效的课程代码");
        }
        Course course = repository.course(code.strip(), lock);
        if (course == null) {
            throw new McpToolException("未找到该课程，请确认课程代码");
        }
        return course;
    }
}
