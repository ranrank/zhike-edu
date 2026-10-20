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

package com.nageoffer.ai.ragent.infra.embedding;

import com.nageoffer.ai.ragent.infra.enums.ModelProvider;
import okhttp3.OkHttpClient;
import org.springframework.stereotype.Service;

/**
 * 词元跳动中转站 Embedding 客户端
 * 走标准 OpenAI 兼容协议；维度由候选配置的 dimension 透传（本项目表结构固定 1536）
 */
@Service
public class TokendanceEmbeddingClient extends AbstractOpenAIStyleEmbeddingClient {

    public TokendanceEmbeddingClient(OkHttpClient syncHttpClient) {
        super(syncHttpClient);
    }

    @Override
    public String provider() {
        return ModelProvider.TOKENDANCE.getId();
    }

    /**
     * 上游是通义 text-embedding-v4，百炼 compatible-mode 批量上限为 10
     * 中转站不改变上游限制，超限整批 400，故与百炼保持一致
     */
    @Override
    protected int maxBatchSize() {
        return 10;
    }
}
