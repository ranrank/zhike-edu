import * as React from "react";

import { AgentTurnItem } from "@/components/agent/AgentTurn";
import { getSampleQuestionsPage } from "@/services/sampleQuestionService";
import { useAgentChatStore } from "@/stores/agentChatStore";
import { useAuthStore } from "@/stores/authStore";
import type { AgentTurn } from "@/types/agent";

/** 待机页取几条 后台配得少就少显示 不凑数 */
const SAMPLE_LIMIT = 4;

/** 图注带：四格按时间顺序讲一次问答的四段 ▷○●▮ 只在这里解释一次 */
const STEPS = [
  ["▷", "提问", "你说的原话"],
  ["○", "思考", "它怎么想的"],
  ["●", "工具", "调了什么、返回什么"],
  ["▮", "答复", "最后怎么答"]
];

/**
 * 预演轨迹：结构与真轨迹完全一致 走同一个 AgentTurnItem
 * 时刻写死不取当前时间 空态每次渲染都该长一样 也方便截图自验
 * 使用虚构样例演示「先查画像，再判断资格」，不将静态预演当作当前账号的真实查询结果。
 */
const DEMO_TURN: AgentTurn = {
  id: "demo",
  index: 1,
  user: {
    id: "demo-u",
    role: "user",
    content: "我能选毕业设计 CS401 吗？",
    createdAt: "2026-01-01T09:41:03"
  },
  assistants: [
    {
      id: "demo-a",
      role: "assistant",
      content: "",
      status: "done",
      elapsedMs: 4200,
      createdAt: "2026-01-01T09:41:03",
      blocks: [
        {
          id: 1,
          kind: "reasoning",
          at: "09:41:03",
          text: "选课资格取决于个人状态。先查询当前学生档案，再匹配专业和培养方案版本对应的规则。"
        },
        {
          id: 2,
          kind: "tool",
          at: "09:41:04",
          name: "get_student_profile",
          displayName: "学生画像查询",
          status: "done",
          // 各自独批
          batchId: "demo-0",
          callIndex: 0,
          durationMs: 1200,
          result:
            "## 虚构学生样例\n\n- 专业：计算机科学与技术，培养方案 CS-2024\n- 当前第 2 学年，已修 45 学分\n- 已通过先修课程 CS201"
        },
        {
          id: 3,
          kind: "reasoning",
          at: "09:41:05",
          text: "学生状态已经取得，继续用当前专业和 CS-2024 版本匹配 CS401 规则，不能套用其他版本。"
        },
        {
          id: 4,
          kind: "tool",
          at: "09:41:06",
          name: "check_course_eligibility",
          displayName: "选课资格判断",
          status: "done",
          batchId: "demo-1",
          callIndex: 0,
          durationMs: 900,
          result:
            "## 示例培养方案 CS-2024 · 第4条 毕业设计\n\n- 第 4 学年且已修至少 100 学分，通过 CS201 后可选\n- 结论：INELIGIBLE，当前年级和已修学分均未达标"
        },
        {
          id: 5,
          kind: "answer",
          at: "09:41:07",
          text: "**按此虚构样例，你目前不能选毕业设计 CS401。**\n\n《示例计算机专业培养方案 CS-2024》第4条要求第 4 学年、已修至少 100 学分且通过 CS201。你已满足先修课条件，但当前为第 2 学年、已修 45 学分，尚未满足年级和学分要求。\n\n这是一段演示，实际结论以当前账号档案和适用规则为准。"
        }
      ]
    }
  ]
};

type SampleState =
  | { status: "loading" }
  | { status: "ready"; items: string[] }
  | { status: "error" };

/** 取过一次就记在模块里：换会话回到待机页不该重新洗牌 */
let cachedQuestions: string[] | null = null;

function useSampleQuestions() {
  const [state, setState] = React.useState<SampleState>(() =>
    cachedQuestions ? { status: "ready", items: cachedQuestions } : { status: "loading" }
  );
  const aliveRef = React.useRef(true);

  const load = React.useCallback(() => {
    setState({ status: "loading" });
    getSampleQuestionsPage(1, SAMPLE_LIMIT, "知课教务")
      .then((page) => {
        const items = (page.records ?? [])
          .map((row) => row.question?.trim())
          .filter((question): question is string => Boolean(question));
        cachedQuestions = items;
        if (aliveRef.current) setState({ status: "ready", items });
      })
      .catch(() => {
        if (aliveRef.current) setState({ status: "error" });
      });
  }, []);

  React.useEffect(() => {
    aliveRef.current = true;
    if (!cachedQuestions) load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  return { state, reload: load };
}

/** 示例问题：来自后台配置 点一条只填进输入框 发不发由用户决定 */
function AgentSampleQuestions() {
  const setDraft = useAgentChatStore((store) => store.setDraft);
  const isAdmin = useAuthStore((store) => store.user?.role === "admin");
  const { state, reload } = useSampleQuestions();

  // 加载中不占位也不放骨架屏：请求就在同一屏内 闪一下比空框好
  if (state.status === "loading") {
    return null;
  }

  const questions = state.status === "ready" ? state.items : [];
  const isBlank = questions.length === 0;

  return (
    <section className="agent-empty-try">
      <span className="agent-empty-try-label">试试这些</span>
      {isBlank ? (
        <div className="agent-empty-blank">
          {state.status === "error" ? (
            <p>示例问题没取到，不影响提问——直接在下面写下你想问的就行。</p>
          ) : (
            <p>
              管理控制台还没有配置示例问题，直接在下面输入框写下你想问的就行
              {/* 管理员多一节句内旁注：指路而已 不给钮形——那个位置正常态摆的是能点的问句 摆一枚离开本页的钮就成了这屏最像动作的东西 */}
              {isAdmin ? (
                <>
                  ；也可以
                  <a
                    className="agent-empty-blank-link"
                    href="/admin/sample-questions"
                    target="_blank"
                    rel="noreferrer"
                  >
                    去后台添加几条
                  </a>
                </>
              ) : null}
              。
            </p>
          )}
          {state.status === "error" ? (
            <button type="button" className="agent-empty-blank-btn" onClick={reload}>
              重试
            </button>
          ) : null}
        </div>
      ) : (
        <div className="agent-empty-chips">
          {questions.map((question) => (
            <button
              key={question}
              type="button"
              className="agent-empty-chip"
              title="点击填入输入框"
              onClick={() => setDraft(question)}
            >
              <span>{question}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 待机空态：一张卡讲清"你的话会怎样被打出来" 再给一行能点的问句
 * 演示 + 图注带 + 问句行收进同一张卡整块居中 留白封顶不摊成两块死区 排布见 globals.css
 */
export function AgentWelcomeScreen() {
  return (
    <div className="agent-stream-empty">
      <div className="agent-empty-wrap">
        {/* 三段一张卡：边框圆角挂外层 figure 只管「演示 + 注」这对语义（figcaption 必须是 figure 的首尾子元素 问句行只能落在外层） */}
        <div className="agent-empty-card">
          <figure className="agent-empty-figure">
            <div className="agent-empty-demo" aria-hidden="true">
              <AgentTurnItem turn={DEMO_TURN} note="示例" />
            </div>
            <figcaption className="agent-empty-cap">
              {STEPS.map(([glyph, name, desc]) => (
                <span key={glyph} className="agent-empty-step">
                  <span className="agent-empty-step-head">
                    {/* 答复那一格的字符跟着卡里的答复节点转橙 图例与被解释的东西不许两个颜色 */}
                    <span
                      className="agent-empty-step-glyph"
                      data-answer={glyph === "▮" ? "true" : undefined}
                    >
                      {glyph}
                    </span>
                    {name}
                  </span>
                  <span className="agent-empty-step-desc">{desc}</span>
                </span>
              ))}
            </figcaption>
          </figure>
          <AgentSampleQuestions />
        </div>
      </div>
    </div>
  );
}
