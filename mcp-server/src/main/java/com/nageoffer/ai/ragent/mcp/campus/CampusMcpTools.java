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
import com.nageoffer.ai.ragent.mcp.config.McpToolAnnotations;
import com.nageoffer.ai.ragent.mcp.executor.McpToolException;
import com.nageoffer.ai.ragent.mcp.executor.McpToolResults;
import com.nageoffer.ai.ragent.mcp.executor.McpToolSchema;
import io.modelcontextprotocol.server.McpServerFeatures;
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest;
import io.modelcontextprotocol.spec.McpSchema.CallToolResult;
import io.modelcontextprotocol.spec.McpSchema.Tool;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Map;
import java.util.function.BiFunction;

import static com.nageoffer.ai.ragent.mcp.campus.CampusModels.*;
import static com.nageoffer.ai.ragent.mcp.executor.McpToolSchema.string;

@Slf4j
@Configuration
@RequiredArgsConstructor
@ConditionalOnProperty(prefix = "ragent.campus", name = "enabled", havingValue = "true", matchIfMissing = true)
public class CampusMcpTools {
    private final CampusService service;

    @Bean
    public McpServerFeatures.SyncToolSpecification studentProfileTool() {
        return tool("get_student_profile", "查询当前登录学生的学院、专业、年级、培养方案版本、已修学分与已通过课程。"
                + "涉及个人选课资格时先查此工具，再以返回的专业和版本查规则；不接受他人的学号或用户 ID。",
                McpToolSchema.object(), true, (user, args) -> {
                    Student student = service.profile(user);
                    return Map.of("student", student, "passedCourses", service.passedCourses(user),
                            "knowledgeQueryPrefix", student.major() + " " + student.planVersion() + " 培养方案");
                });
    }

    @Bean
    public McpServerFeatures.SyncToolSpecification academicRulesTool() {
        return tool("search_academic_rules", "先查当前学生档案，再精确匹配指定课程的专业、培养方案版本及有效期规则。"
                + "返回规则原文、出处和条款；无规则或冲突时不能猜测资格。知识库检索用于解释细则，不替代此匹配。",
                courseSchema(), true, (user, args) -> service.rules(user, required(args, "courseCode")));
    }

    @Bean
    public McpServerFeatures.SyncToolSpecification courseEligibilityTool() {
        return tool("check_course_eligibility", "判断当前学生能否选指定课程：先查画像，再匹配规则，并校验学籍、年级、学分、先修课、"
                + "开放期和名额。返回 ELIGIBLE / INELIGIBLE / UNKNOWN、原因与规则出处；本工具不会提交选课。",
                courseSchema(), true, (user, args) -> service.check(user, required(args, "courseCode")));
    }

    @Bean
    public McpServerFeatures.SyncToolSpecification enrollCourseTool() {
        return tool("enroll_course", "为当前学生提交选课，需用户确认。提交时重新查询学生状态和适用规则，原子占用名额；"
                + "同一学生同一学期同一课程重复提交返回原记录。仅作用于本地教务演示库。",
                courseSchema(), false, (user, args) -> service.enroll(user, required(args, "courseCode"), false));
    }

    @Bean
    public McpServerFeatures.SyncToolSpecification retakeCourseTool() {
        return tool("register_course_retake", "为当前学生提交重修报名，需用户确认。必须存在该课程的未通过记录，"
                + "同时满足当前规则及名额；重复提交返回原记录。仅作用于本地教务演示库。",
                courseSchema(), false, (user, args) -> service.enroll(user, required(args, "courseCode"), true));
    }

    @Bean
    public McpServerFeatures.SyncToolSpecification studentLeaveTool() {
        McpToolSchema schema = McpToolSchema.object()
                .required(string("requestId", "本次申请的唯一标识，使用字母数字下划线或短横线；重试须保持不变，修改内容须换新标识").title("申请标识"))
                .required(string("startDate", "请假开始日期，YYYY-MM-DD").title("开始日期"))
                .required(string("endDate", "请假结束日期，YYYY-MM-DD；包含起止日在内不超过 7 天").title("结束日期"))
                .required(string("reason", "请假事由，1 至 500 字").title("请假事由"));
        return tool("apply_student_leave", "提交当前学生的请假申请，需用户确认。演示流程支持今天或未来开始、最多 7 天；"
                + "成功仅表示待审批，不表示获准离校。仅作用于本地教务演示库。",
                schema, false, (user, args) -> service.applyLeave(user, required(args, "requestId"),
                        McpToolResults.parseDate(required(args, "startDate")),
                        McpToolResults.parseDate(required(args, "endDate")), required(args, "reason")));
    }

    private McpToolSchema courseSchema() {
        return McpToolSchema.object().required(string("courseCode", "课程代码，例如 CS401；不知道时先询问，不能凭课程名猜代码").title("课程代码"));
    }

    private McpServerFeatures.SyncToolSpecification tool(String name, String description, McpToolSchema schema,
                                                       boolean readOnly, BiFunction<String, Map<String, Object>, Object> action) {
        Tool definition = Tool.builder().name(name).description(description).inputSchema(schema.build())
                .annotations(readOnly ? McpToolAnnotations.READ_ONLY : McpToolAnnotations.WRITE).build();
        return McpServerFeatures.SyncToolSpecification.builder().tool(definition)
                .callHandler((exchange, request) -> execute(name, request, action)).build();
    }

    private CallToolResult execute(String name, CallToolRequest request,
                                   BiFunction<String, Map<String, Object>, Object> action) {
        String userId = McpToolResults.userId(request);
        if (userId == null) {
            return McpToolResults.identityRequired(name);
        }
        try {
            Map<String, Object> args = McpToolResults.args(request);
            if (args.containsKey("userId") || args.containsKey("studentId")) {
                throw new McpToolException("不接受指定他人的身份参数，只能操作当前账号的教务记录");
            }
            // Hutool 不保证 Java record 的属性序列化，统一使用显式 record 转换。
            return McpToolResults.success(JSONUtil.toJsonStr(CampusToolPayload.of(action.apply(userId, args))));
        } catch (Exception e) {
            log.warn("教务工具调用失败, toolId={}", name, e);
            return McpToolResults.failure("教务操作", e);
        }
    }

    private String required(Map<String, Object> args, String key) {
        Object value = args.get(key);
        if (!(value instanceof String text) || text.isBlank()) {
            throw new McpToolException("缺少必填信息：" + key);
        }
        return text.strip();
    }
}
