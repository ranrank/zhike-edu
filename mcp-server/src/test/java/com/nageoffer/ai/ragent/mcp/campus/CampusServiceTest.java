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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;

import static com.nageoffer.ai.ragent.mcp.campus.CampusModels.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class CampusServiceTest {
    private CampusRepository repository;
    private CampusService service;
    private final Clock clock = Clock.fixed(Instant.parse("2026-10-19T04:00:00Z"), ZoneId.of("Asia/Shanghai"));
    private Student senior;
    private Course course;
    private Rule rule;

    @BeforeEach
    void setUp() {
        repository = mock(CampusRepository.class);
        service = new CampusService(repository, mock(TransactionTemplate.class), clock);
        senior = student(4, "120", "ACTIVE");
        course = new Course("CS401", "毕业设计", "2026-2027-1", new BigDecimal("8"), 1, true);
        rule = new Rule("rule-2022", "CS401", "计算机科学与技术", "CS-2022", 4, 4, new BigDecimal("100"),
                "CS201", "示例培养方案 CS-2022", "第4条", "毕业设计规则", LocalDate.of(2020,1,1), LocalDate.of(2100,12,31));
        when(repository.student("me", false)).thenReturn(senior);
        when(repository.course("CS401", false)).thenReturn(course);
        when(repository.rules(any(), eq("CS401"), eq(LocalDate.of(2026,10,19)))).thenReturn(List.of(rule));
        when(repository.courseResult("me", "CS201")).thenReturn("PASSED");
    }

    @Test
    void seniorPassesAndKeepsRuleEvidence() {
        Eligibility result = service.check("me", "CS401");
        assertEquals("ELIGIBLE", result.status());
        assertEquals("示例培养方案 CS-2022", result.rule().sourceTitle());
        verify(repository).rules(senior, "CS401", LocalDate.of(2026,10,19));
    }

    @Test
    void sophomoreCannotChooseSameCourseAsSenior() {
        when(repository.student("me", false)).thenReturn(student(2, "45", "ACTIVE"));
        Eligibility result = service.check("me", "CS401");
        assertEquals("INELIGIBLE", result.status());
        assertEquals(2, result.reasons().size());
        assertTrue(result.reasons().get(0).contains("第 2 学年"));
    }

    @Test
    void missingPrerequisiteBlocksEvenWithEnoughCredits() {
        when(repository.courseResult("me", "CS201")).thenReturn("FAILED");
        assertTrue(service.check("me", "CS401").reasons().contains("尚未通过先修课程 CS201"));
    }

    @Test
    void insufficientCreditsBlockSenior() {
        when(repository.student("me", false)).thenReturn(student(4, "99.5", "ACTIVE"));
        assertEquals("INELIGIBLE", service.check("me", "CS401").status());
    }

    @ParameterizedTest
    @ValueSource(strings = {"SUSPENDED", "GRADUATED"})
    void inactiveStudentCannotEnroll(String status) {
        when(repository.student("me", false)).thenReturn(student(4, "120", status));
        assertEquals("INELIGIBLE", service.check("me", "CS401").status());
    }

    @Test
    void missingRuleIsUnknownRatherThanEligible() {
        when(repository.rules(any(), anyString(), any())).thenReturn(List.of());
        assertEquals("UNKNOWN", service.check("me", "CS401").status());
    }

    @Test
    void conflictingRulesAreUnknown() {
        when(repository.rules(any(), anyString(), any())).thenReturn(List.of(rule, rule));
        assertEquals("UNKNOWN", service.check("me", "CS401").status());
    }

    @Test
    void closedSelectionBlocks() {
        when(repository.course("CS401", false)).thenReturn(new Course("CS401", "毕业设计", "2026-2027-1", BigDecimal.ONE, 1, false));
        assertEquals("INELIGIBLE", service.check("me", "CS401").status());
    }

    @Test
    void zeroCapacityBlocks() {
        when(repository.course("CS401", false)).thenReturn(new Course("CS401", "毕业设计", "2026-2027-1", BigDecimal.ONE, 0, true));
        assertEquals("INELIGIBLE", service.check("me", "CS401").status());
    }

    @Test
    void passedCourseCannotBeChosenAgain() {
        when(repository.courseResult("me", "CS401")).thenReturn("PASSED");
        assertEquals("INELIGIBLE", service.check("me", "CS401").status());
    }

    @Test
    void missingProfileMustNotUseSelfReportedData() {
        when(repository.student("me", false)).thenReturn(null);
        assertThrows(McpToolException.class, () -> service.check("me", "CS401"));
        verify(repository, never()).rules(any(), anyString(), any());
    }

    @Test
    void missingIdentityNeverQueriesRepository() {
        assertThrows(McpToolException.class, () -> service.profile(null));
        verifyNoInteractions(repository);
    }

    @Test
    void missingCourseCannotBeGuessed() {
        when(repository.course("CS401", false)).thenReturn(null);
        assertThrows(McpToolException.class, () -> service.check("me", "CS401"));
    }

    @Test
    void invalidLeaveDatesDoNotWrite() {
        assertThrows(McpToolException.class, () -> service.applyLeave("me", "request-1", LocalDate.of(2026,10,18), LocalDate.of(2026,10,19), "事假"));
        assertThrows(McpToolException.class, () -> service.applyLeave("me", "request-1", LocalDate.of(2026,10,19), LocalDate.of(2026,10,26), "事假"));
        assertThrows(McpToolException.class, () -> service.applyLeave("me", "request-1", null, LocalDate.of(2026,10,19), "事假"));
        verifyNoInteractions(repository);
    }

    private Student student(int year, String credits, String status) {
        return new Student("me", "计算机学院", "计算机科学与技术", year, "CS-2022", new BigDecimal(credits), status);
    }
}
