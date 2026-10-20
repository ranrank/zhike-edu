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

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.support.EncodedResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Clock;
import java.time.ZoneId;

@Configuration
@ConditionalOnProperty(prefix = "ragent.campus", name = "enabled", havingValue = "true", matchIfMissing = true)
public class CampusConfiguration {
    @Bean
    public CampusRepository campusRepository(DataSource dataSource) throws SQLException {
        // 仅建独立教务表，不在服务启动时清空或灌入演示学生。
        try (Connection connection = dataSource.getConnection()) {
            ScriptUtils.executeSqlScript(connection, new EncodedResource(
                    new ClassPathResource("db/campus-schema.sql"), StandardCharsets.UTF_8));
        }
        return new CampusRepository(new JdbcTemplate(dataSource));
    }

    @Bean
    public CampusService campusService(CampusRepository repository, TransactionTemplate transactions) {
        return new CampusService(repository, transactions, Clock.system(ZoneId.of("Asia/Shanghai")));
    }
}
