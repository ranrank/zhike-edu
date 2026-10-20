package com.nageoffer.ai.ragent.initializer;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 仅新增教务数据；停用旧意图和技能前保存可恢复快照，不执行通用 cleanup。 */
public final class CampusInitMain {
    private CampusInitMain() {
    }

    public static void main(String[] args) {
        MainSupport.run(args, context -> {
            context.dataset().verifyChecksums();
            if (context.dryRun()) {
                System.out.printf("[campus][dry-run] 校验通过：knowledgeBases=%d documents=%d intents=%d questions=%d%n",
                        context.dataset().knowledgeBases().size(), context.dataset().documentCount(),
                        context.dataset().intents().size(), context.dataset().questions().size());
                return;
            }
            InitializationActions.preflight(context);
            saveSnapshot(context);
            InitializationActions.initializeKnowledgeBases(context);
            InitializationActions.initializeDocuments(context);
            seedDemo(context);
            upsertIntents(context);
            addQuestions(context);
            InitializationActions.initializeAgentProfile(context);
            disablePreviousScenario(context);
            System.out.println("[campus] 完成；原有知识库、对话及业务记录均保留，旧意图和技能已停用。演示档案仅在本地有效。");
        });
    }

    private static void saveSnapshot(InitializerContext context) throws Exception {
        Path snapshot = context.agentTypeDir().resolve(".state/before-campus.json");
        if (Files.exists(snapshot)) {
            System.out.println("[campus] 保留已有切换前快照，不覆盖");
            return;
        }
        Map<String, Object> state = new LinkedHashMap<>();
        state.put("intents", context.http().get("/intent-tree/trees"));
        state.put("skills", pages(context, "/agent-skills"));
        state.put("profiles", context.http().get("/agents"));
        Files.createDirectories(snapshot.getParent());
        Files.writeString(snapshot, SimpleJson.stringify(state), StandardCharsets.UTF_8);
        System.out.println("[campus] 已保存切换前配置快照: " + snapshot);
    }

    private static void seedDemo(InitializerContext context) throws Exception {
        Path repository = context.agentTypeDir().getParent().getParent().getParent();
        context.bizJdbc().executeScript(repository.resolve("mcp-server/src/main/resources/db/campus-demo.sql"), Map.of());
        String userId = SimpleJson.string(SimpleJson.object(context.http().get("/user/me")), "id");
        // /user/me 的字段由服务端 DTO 定义，只接受实际回读的登录 ID，不接受外部任意身份。
        if (userId == null) {
            userId = SimpleJson.string(SimpleJson.object(context.http().get("/user/me")), "userId");
        }
        if (userId == null || !userId.matches("[0-9]{1,32}")) {
            throw new IllegalStateException("无法取得当前管理员账号 ID，未绑定演示档案");
        }
        Path bind = context.agentTypeDir().resolve("bind-demo-student.sql");
        context.bizJdbc().executeScript(bind, Map.of("currentUserId", userId));
        System.out.println("[campus] 已补充虚构样例；当前初始化账号绑定大二样例，已有档案不会覆盖");
    }

    private static void upsertIntents(InitializerContext context) throws Exception {
        Map<String, Map<String, Object>> existing = new LinkedHashMap<>();
        for (Map<String, Object> node : flatten(context.http().get("/intent-tree/trees"))) {
            existing.put(SimpleJson.string(node, "intentCode"), node);
        }
        for (InitializerDataset.IntentDefinition intent : context.dataset().intents()) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("intentCode", intent.code());
            payload.put("name", intent.name());
            payload.put("level", intent.level());
            payload.put("kind", intent.kind());
            payload.put("description", intent.description());
            payload.put("examples", intent.examples());
            payload.put("requireConfirm", intent.requireConfirm() ? 1 : 0);
            payload.put("sortOrder", intent.sortOrder());
            payload.put("enabled", 1);
            if (intent.mcpToolId() != null) {
                payload.put("mcpToolId", intent.mcpToolId());
            }
            if (intent.knowledgeBaseRef() != null) {
                var kb = context.knowledgeBases().get(intent.knowledgeBaseRef());
                payload.put("kbId", kb.id());
                payload.put("collectionNames", List.of(kb.collectionName()));
            }
            Map<String, Object> old = existing.get(intent.code());
            if (old == null) {
                context.http().postJson("/intent-tree", payload);
            } else {
                context.http().putJson("/intent-tree/" + RagentHttpClient.encodePath(SimpleJson.string(old, "id")), payload);
            }
        }
    }

    private static void addQuestions(InitializerContext context) throws Exception {
        Set<String> existing = new HashSet<>();
        for (Map<String, Object> question : pages(context, "/sample-questions")) {
            existing.add(SimpleJson.string(question, "question"));
        }
        for (InitializerDataset.QuestionDefinition question : context.dataset().questions()) {
            if (!existing.contains(question.text())) {
                context.http().postJson("/sample-questions", Map.of("title", "知课教务 · " + question.title(),
                        "description", "知课教务虚构规则演示", "question", question.text()));
            }
        }
    }

    private static void disablePreviousScenario(InitializerContext context) throws Exception {
        // 技能先停用，再停用它们引用的工具节点。日期工具是跨领域只读工具，保留。
        for (Map<String, Object> skill : pages(context, "/agent-skills")) {
            context.http().postEmpty("/agent-skills/" + RagentHttpClient.encodePath(SimpleJson.string(skill, "id")) + "/enabled?enabled=false");
        }
        List<String> oldIds = new ArrayList<>();
        for (Map<String, Object> node : flatten(context.http().get("/intent-tree/trees"))) {
            String code = SimpleJson.string(node, "intentCode");
            if ((code == null || !code.startsWith("campus-"))
                    && !"current_date".equals(SimpleJson.string(node, "mcpToolId"))) {
                oldIds.add(SimpleJson.string(node, "id"));
            }
        }
        if (!oldIds.isEmpty()) {
            context.http().postJson("/intent-tree/batch/disable", Map.of("ids", oldIds));
        }
    }

    static List<Map<String, Object>> pages(InitializerContext context, String endpoint) throws Exception {
        List<Map<String, Object>> result = new ArrayList<>();
        for (int current = 1; ; current++) {
            Map<String, Object> page = SimpleJson.object(context.http().get(endpoint + "?current=" + current + "&size=100"));
            List<Object> records = SimpleJson.array(page.get("records"));
            for (Object item : records) result.add(SimpleJson.object(item));
            if (records.isEmpty() || result.size() >= SimpleJson.integer(page, "total", result.size())) break;
        }
        return result;
    }

    static List<Map<String, Object>> flatten(Object tree) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Object item : SimpleJson.array(tree)) {
            Map<String, Object> node = SimpleJson.object(item);
            result.add(node);
            if (node.get("children") != null) result.addAll(flatten(node.get("children")));
        }
        return result;
    }
}
