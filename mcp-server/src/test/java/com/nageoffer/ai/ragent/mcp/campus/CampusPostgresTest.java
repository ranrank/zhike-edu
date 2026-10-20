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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.support.EncodedResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;

import static org.junit.jupiter.api.Assertions.*;

/** 只对显式指定的本机独立测试库运行，不触碰 ragent / ragent_bit。 */
@EnabledIfEnvironmentVariable(named = "CAMPUS_TEST_JDBC_URL", matches = "jdbc:postgresql:.*")
class CampusPostgresTest {
    private JdbcTemplate jdbc;
    private CampusService service;

    @BeforeEach
    void setUp() throws Exception {
        String url = System.getenv("CAMPUS_TEST_JDBC_URL");
        assertTrue(url.matches("jdbc:postgresql://127\\.0\\.0\\.1:5432/ragent_campus_test_[a-z0-9_]+"), "只允许独立测试库");
        var dataSource = new DriverManagerDataSource(url, "postgres", "postgres");
        jdbc = new JdbcTemplate(dataSource);
        try (var connection = dataSource.getConnection()) {
            ScriptUtils.executeSqlScript(connection, new EncodedResource(new ClassPathResource("db/campus-schema.sql"), StandardCharsets.UTF_8));
            jdbc.execute("TRUNCATE campus_leave_application,campus_enrollment,campus_course_rule,campus_transcript,campus_course,campus_student");
            ScriptUtils.executeSqlScript(connection, new EncodedResource(new ClassPathResource("db/campus-demo.sql"), StandardCharsets.UTF_8));
        }
        service = new CampusService(new CampusRepository(jdbc), new TransactionTemplate(new DataSourceTransactionManager(dataSource)),
                Clock.system(ZoneId.of("Asia/Shanghai")));
    }

    @Test
    void sameCourseProducesDifferentPersonalizedDecisions() {
        assertEquals("INELIGIBLE", service.check("campus-demo-year2", "CS401").status());
        var senior = service.check("campus-demo-year4", "CS401");
        assertEquals("ELIGIBLE", senior.status());
        assertEquals("CS-2022", senior.rule().planVersion());
        assertEquals("INELIGIBLE", service.check("campus-demo-low-credit", "CS401").status());
        assertEquals("INELIGIBLE", service.check("campus-demo-no-prereq", "CS401").status());
        assertEquals("UNKNOWN", service.check("campus-demo-unknown-plan", "CS401").status());
    }

    @Test
    void expiredRulesCannotMatch() {
        jdbc.update("UPDATE campus_course_rule SET valid_until = ?", LocalDate.now().minusDays(1));
        assertEquals("UNKNOWN", service.check("campus-demo-year4", "CS401").status());
    }

    @Test
    void rulesForOtherMajorsCannotMatch() {
        jdbc.update("UPDATE campus_student SET major = '软件工程' WHERE user_id = 'campus-demo-year4'");
        assertEquals("UNKNOWN", service.check("campus-demo-year4", "CS401").status());
    }

    @Test
    void duplicateEnrollmentReturnsSameRecordAndConsumesOneSeat() {
        var first = service.enroll("campus-demo-year4", "CS401", false);
        var second = service.enroll("campus-demo-year4", "CS401", false);
        assertEquals(first.id(), second.id());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM campus_enrollment", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT remaining_seats FROM campus_course WHERE course_code='CS401'", Integer.class));
    }

    @Test
    void confirmedWriteRechecksState() {
        assertTrue(service.check("campus-demo-year4", "CS401").eligible());
        jdbc.update("UPDATE campus_student SET student_status='SUSPENDED' WHERE user_id='campus-demo-year4'");
        assertThrows(McpToolException.class, () -> service.enroll("campus-demo-year4", "CS401", false));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM campus_enrollment", Integer.class));
    }

    @Test
    void concurrentStudentsCannotTakeLastSeatTwice() throws Exception {
        jdbc.update("UPDATE campus_course SET remaining_seats=1 WHERE course_code='CS401'");
        jdbc.update("UPDATE campus_student SET completed_credits=120 WHERE user_id='campus-demo-low-credit'");
        var pool = Executors.newFixedThreadPool(2);
        try {
            Callable<Boolean> a = () -> tryEnroll("campus-demo-year4");
            Callable<Boolean> b = () -> tryEnroll("campus-demo-low-credit");
            var results = pool.invokeAll(List.of(a, b));
            long succeeded = 0;
            for (var result : results) if (result.get()) succeeded++;
            assertEquals(1, succeeded);
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM campus_enrollment", Integer.class));
            assertEquals(0, jdbc.queryForObject("SELECT remaining_seats FROM campus_course WHERE course_code='CS401'", Integer.class));
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void retakeRequiresFailedTranscriptAndIsIdempotent() {
        assertThrows(McpToolException.class, () -> service.enroll("campus-demo-year2", "CS402", true));
        var first = service.enroll("campus-demo-retake", "CS402", true);
        assertEquals("RETAKE", first.type());
        assertEquals(first.id(), service.enroll("campus-demo-retake", "CS402", true).id());
    }

    @Test
    void leaveIsPendingIdempotentAndScopedToCurrentUser() {
        LocalDate start = LocalDate.now(ZoneId.of("Asia/Shanghai"));
        var first = service.applyLeave("campus-demo-year2", "leave-1", start, start.plusDays(1), "事假");
        assertEquals("PENDING", first.status());
        assertEquals(first.id(), service.applyLeave("campus-demo-year2", "leave-1", start, start.plusDays(1), "事假").id());
        assertThrows(McpToolException.class, () -> service.applyLeave("campus-demo-year2", "leave-1", start, start, "另一件事"));
        var other = service.applyLeave("campus-demo-year4", "leave-1", start, start, "事假");
        assertNotEquals(first.id(), other.id());
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM campus_leave_application", Integer.class));
    }

    private boolean tryEnroll(String user) {
        try {
            service.enroll(user, "CS401", false);
            return true;
        } catch (McpToolException e) {
            return false;
        }
    }
}
