#!/bin/bash
# Elasticsearch 启动脚本：首次运行时安装 IK 中文分词插件
#
# 为什么需要这个脚本而不是直接 docker run：
#   官方 elasticsearch 镜像不含 IK 插件，而中文分词必须用它
#   （配置里 analyzer: ik_max_word / search-analyzer: ik_smart）
#   插件的安装需要重启容器，所以放在 entrypoint 里"装完再启动"
#
# 插件来源：INFINI Labs 提供的 IK 分发（与 ES 版本严格对应，9.2.0 必须配 9.2.0）
# 版本必须跟着 compose 里的 elasticsearch 镜像走

set -e

PLUGIN_DIR="/usr/share/elasticsearch/plugins/analysis-ik"
IK_URL="https://get.infini.cloud/elasticsearch/analysis-ik/9.2.0"

if [ -d "$PLUGIN_DIR" ]; then
    echo "==> IK 插件已存在，跳过安装"
else
    echo "==> 首次启动，安装 IK 中文分词插件..."
    if bin/elasticsearch-plugin install --batch "$IK_URL"; then
        echo "==> IK 插件安装成功"
    else
        echo "==> ⚠️ IK 插件安装失败（可能是网络问题）"
        echo "    容器仍会启动，但中文分词会退化为按字切分，关键词检索效果会变差"
        echo "    重试方法：docker compose ... restart elasticsearch"
    fi
fi

echo "==> 启动 Elasticsearch..."
exec bin/elasticsearch
