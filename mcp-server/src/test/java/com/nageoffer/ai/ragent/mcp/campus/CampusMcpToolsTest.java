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

import cn.hutool.json.JSONUtil;
import com.nageoffer.ai.ragent.mcp.executor.McpToolResults;
import io.modelcontextprotocol.server.McpServerFeatures.SyncToolSpecification;
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest;
import io.modelcontextprotocol.spec.McpSchema.TextContent;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class CampusMcpToolsTest {
    @Test
    void writesRequireExistingConfirmationFlow() {
        CampusMcpTools tools = new CampusMcpTools(mock(CampusService.class));
        for (SyncToolSpecification spec : List.of(tools.enrollCourseTool(), tools.retakeCourseTool(), tools.studentLeaveTool())) {
            assertFalse(spec.tool().annotations().readOnlyHint());
            assertTrue(spec.tool().inputSchema().properties().values().stream().allMatch(p -> ((Map<?, ?>)p).containsKey("title")));
        }
        for (SyncToolSpecification spec : List.of(tools.studentProfileTool(), tools.academicRulesTool(), tools.courseEligibilityTool())) {
            assertTrue(spec.tool().annotations().readOnlyHint());
            assertFalse(spec.tool().inputSchema().properties().containsKey("userId"));
        }
    }

    @Test
    void missingIdentityCannotReadOrWrite() {
        CampusService service = mock(CampusService.class);
        CampusMcpTools tools = new CampusMcpTools(service);
        for (SyncToolSpecification spec : List.of(tools.studentProfileTool(), tools.academicRulesTool(), tools.courseEligibilityTool(),
                tools.enrollCourseTool(), tools.retakeCourseTool(), tools.studentLeaveTool())) {
            assertTrue(spec.callHandler().apply(null, request(spec.tool().name(), Map.of(), null)).isError());
        }
        verifyNoInteractions(service);
    }

    @Test
    void cannotSpecifyAnotherStudentInArguments() {
        CampusService service = mock(CampusService.class);
        var tool = new CampusMcpTools(service).courseEligibilityTool();
        assertTrue(tool.callHandler().apply(null, request(tool.tool().name(), Map.of("courseCode", "CS401", "userId", "other"), "me")).isError());
        verifyNoInteractions(service);
    }

    @Test
    void profileRecordIsSerializedWithActualValues() {
        CampusService service = mock(CampusService.class);
        when(service.profile("me")).thenReturn(new CampusModels.Student("me", "计算机学院", "计算机科学与技术", 2, "CS-2024", new BigDecimal("45"), "ACTIVE"));
        when(service.passedCourses("me")).thenReturn(List.of("CS201"));
        var tool = new CampusMcpTools(service).studentProfileTool();
        var result = tool.callHandler().apply(null, request(tool.tool().name(), Map.of(), "me"));
        assertFalse(result.isError());
        var payload = JSONUtil.parseObj(((TextContent) result.content().get(0)).text());
        assertEquals("CS-2024", payload.getJSONObject("student").getStr("planVersion"));
        assertEquals(2, payload.getJSONObject("student").getInt("studyYear"));
    }

    @Test
    void underlyingFailureDoesNotExposeSql() {
        CampusService service = mock(CampusService.class);
        when(service.check("me", "CS401")).thenThrow(new IllegalStateException("secret SQL connection string"));
        var tool = new CampusMcpTools(service).courseEligibilityTool();
        var result = tool.callHandler().apply(null, request(tool.tool().name(), Map.of("courseCode", "CS401"), "me"));
        assertTrue(result.isError());
        assertFalse(((TextContent)result.content().get(0)).text().contains("secret"));
    }

    private CallToolRequest request(String name, Map<String, Object> args, String user) {
        return new CallToolRequest(name, args, user == null ? null : Map.of(McpToolResults.META_USER_ID, user));
    }
}
