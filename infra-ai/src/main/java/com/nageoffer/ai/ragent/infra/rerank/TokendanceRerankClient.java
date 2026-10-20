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

package com.nageoffer.ai.ragent.infra.rerank;

import com.nageoffer.ai.ragent.infra.enums.ModelProvider;
import okhttp3.OkHttpClient;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

/**
 * 词元跳动中转站 Rerank 客户端
 * <p>
 * 中转站把通义系能力挂在按供应商分流的独立路径下（{@code /alibaba/text-rerank/v1}），
 * 报文与响应格式同百炼原生一致，故直接复用 {@link AbstractQwenStyleRerankClient}
 */
@Service
public class TokendanceRerankClient extends AbstractQwenStyleRerankClient {

    public TokendanceRerankClient(@Qualifier("syncHttpClient") OkHttpClient httpClient) {
        super(httpClient);
    }

    @Override
    public String provider() {
        return ModelProvider.TOKENDANCE.getId();
    }
}
