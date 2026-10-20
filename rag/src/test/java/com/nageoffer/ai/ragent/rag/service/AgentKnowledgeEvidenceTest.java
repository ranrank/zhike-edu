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

package com.nageoffer.ai.ragent.rag.service;

import com.nageoffer.ai.ragent.framework.convention.RetrievedChunk;
import com.nageoffer.ai.ragent.rag.dto.RetrievalContext;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class AgentKnowledgeEvidenceTest {
    private RetrievalContext context() {
        return RetrievalContext.builder().kbContext("""
                <content data-ragent-doc-id="private-document-id">
                最多七天；提交后为待审批，不表示批准。
                </content>
                """).intentChunks(Map.of("global", List.of(
                RetrievedChunk.builder().docId("private-document-id").docName("示例请假流程.md").build(),
                RetrievedChunk.builder().docId("not-used-id").docName("不在上下文的过期制度.md").build())))
                .build();
    }

    @Test
    void carriesActualTitleAndEvidenceWithoutInternalIdsOrUnseenDocuments() {
        String result = AgentKnowledgeEvidence.append("最多七天，仍需审批。", context());
        assertTrue(result.startsWith("最多七天，仍需审批。"));
        assertTrue(result.contains("示例请假流程.md"));
        assertTrue(result.contains("不表示批准"));
        assertFalse(result.contains("private-document-id"));
        assertFalse(result.contains("not-used-id"));
        assertFalse(result.contains("不在上下文的过期制度"));
    }

    @Test
    void keepsBlankModelResultBlankRatherThanTurningItIntoASuccessfulEvidenceOnlyAnswer() {
        assertNull(AgentKnowledgeEvidence.append(null, context()));
        assertEquals("", AgentKnowledgeEvidence.append("", context()));
    }

    @Test
    void missingDocumentMetadataDoesNotInventATitle() {
        var context = context();
        context.setIntentChunks(Map.of());
        assertEquals("原答案", AgentKnowledgeEvidence.append("原答案", context));
    }

    @Test
    void repeatedDocumentAppearsOnlyOnceAndExcerptIsBounded() {
        var context = context();
        context.setKbContext(context.getKbContext() + context.getKbContext());
        String result = AgentKnowledgeEvidence.append("答案", context);
        assertEquals(1, result.split("示例请假流程.md", -1).length - 1);
        context.setKbContext(context.getKbContext().replace("最多七天；提交后为待审批，不表示批准。", "正文".repeat(10000)));
        assertTrue(AgentKnowledgeEvidence.append("答案", context).length() < 1500);
    }
}
