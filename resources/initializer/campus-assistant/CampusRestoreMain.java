package com.nageoffer.ai.ragent.initializer;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** 恢复切换前的意图、技能启用状态与激活人设；新增的教务数据仍保留。 */
public final class CampusRestoreMain {
    public static void main(String[] args) {
        MainSupport.run(args, context -> {
            Map<String, Object> snapshot = SimpleJson.object(SimpleJson.parse(Files.readString(
                    context.agentTypeDir().resolve(".state/before-campus.json"), StandardCharsets.UTF_8)));
            if (context.dryRun()) {
                System.out.println("[campus-restore][dry-run] 快照可读取");
                return;
            }
            context.loginAsAdmin();
            List<String> disable = new ArrayList<>();
            for (Map<String, Object> node : CampusInitMain.flatten(context.http().get("/intent-tree/trees"))) {
                if (SimpleJson.string(node, "intentCode").startsWith("campus-")) disable.add(SimpleJson.string(node, "id"));
            }
            if (!disable.isEmpty()) context.http().postJson("/intent-tree/batch/disable", Map.of("ids", disable));
            List<String> enable = new ArrayList<>();
            List<String> oldDisabled = new ArrayList<>();
            for (Map<String, Object> node : CampusInitMain.flatten(snapshot.get("intents"))) {
                boolean enabled = Boolean.TRUE.equals(node.get("enabled")) || "1".equals(String.valueOf(node.get("enabled")));
                (enabled ? enable : oldDisabled).add(SimpleJson.string(node, "id"));
            }
            if (!enable.isEmpty()) context.http().postJson("/intent-tree/batch/enable", Map.of("ids", enable));
            if (!oldDisabled.isEmpty()) context.http().postJson("/intent-tree/batch/disable", Map.of("ids", oldDisabled));
            for (Object item : SimpleJson.array(snapshot.get("skills"))) {
                Map<String, Object> skill = SimpleJson.object(item);
                boolean enabled = Boolean.TRUE.equals(skill.get("enabled")) || "1".equals(String.valueOf(skill.get("enabled")));
                context.http().postEmpty("/agent-skills/" + RagentHttpClient.encodePath(SimpleJson.string(skill, "id")) + "/enabled?enabled=" + enabled);
            }
            Map<String, Object> profiles = SimpleJson.object(snapshot.get("profiles"));
            for (Object item : SimpleJson.array(profiles.get("agents"))) {
                Map<String, Object> profile = SimpleJson.object(item);
                if (Boolean.TRUE.equals(profile.get("active"))) {
                    context.http().postEmpty("/agents/" + RagentHttpClient.encodePath(SimpleJson.string(profile, "id")) + "/activate");
                }
            }
            System.out.println("[campus-restore] 已恢复切换前配置，未删除任何业务记录或教务知识库");
        });
    }
}
