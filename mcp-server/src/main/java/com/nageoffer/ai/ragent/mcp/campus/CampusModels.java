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

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/** 教务状态来自业务库，规则必须与专业、培养方案版本及有效期精确匹配。 */
public final class CampusModels {
    private CampusModels() {
    }

    public record Student(String userId, String college, String major, int studyYear,
                          String planVersion, BigDecimal completedCredits, String status) {
    }

    public record Course(String code, String name, String semester, BigDecimal credits,
                         int remainingSeats, boolean selectionOpen) {
    }

    public record Rule(String id, String courseCode, String major, String planVersion,
                       int minYear, int maxYear, BigDecimal minCredits, String prerequisite,
                       String sourceTitle, String sourceSection, String text,
                       LocalDate validFrom, LocalDate validUntil) {
    }

    public record Eligibility(String status, Student student, Course course, Rule rule,
                              List<String> reasons) {
        public boolean eligible() {
            return "ELIGIBLE".equals(status);
        }
    }

    public record Enrollment(String id, String userId, String courseCode, String semester, String type) {
    }

    public record LeaveApplication(String id, String userId, String requestId,
                                   LocalDate startDate, LocalDate endDate, String reason, String status) {
    }
}
