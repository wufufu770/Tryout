// flowTemplates:3 套面试流程模板(技术面试 / HR 行为面试 / 群面)
// 每个模板预置节点 + 连线,用户可基于模板快速起步
import type { FlowNode, FlowEdge } from "./flowTypes";

function mkNode(
  type: string,
  label: string,
  x: number,
  y: number,
  data?: Record<string, any>,
): FlowNode {
  return {
    id: `node-${type}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    label,
    x,
    y,
    data: data || {},
  };
}

function mkEdge(source: FlowNode, target: FlowNode, label?: string): FlowEdge {
  return {
    id: `edge-${source.id}-${target.id}`,
    source: source.id,
    target: target.id,
    label,
  };
}

export interface FlowTemplate {
  name: string;
  desc: string;
  build: () => { nodes: FlowNode[]; edges: FlowEdge[] };
}

// 3 套模板:覆盖最常见面试场景
// name/desc 为 i18n key,由调用方用 t() 翻译后展示
export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    name: "flow.template.tech.name",
    desc: "flow.template.tech.desc",
    build: () => {
      const scenario = mkNode("scenario", "技术面试", 80, 200, {
        scenarioType: "single",
        sessionTitle: "技术面试",
        description: "考察技术深度与工程实践",
      });
      const interviewer = mkNode("interviewer", "技术面试官", 340, 200, {
        role: "tech",
        tone: "professional",
      });
      const model = mkNode("model", "LLM 模型", 600, 200, {});
      const output = mkNode("output", "启动面试", 860, 200, {
        outputType: "start_interview",
      });
      const material = mkNode("material", "简历 / JD", 340, 60, {});
      const difficulty = mkNode("difficulty", "难度", 80, 60, {
        level: 7,
        duration: 45,
      });
      return {
        nodes: [scenario, interviewer, model, output, material, difficulty],
        edges: [
          mkEdge(scenario, interviewer),
          mkEdge(interviewer, model),
          mkEdge(model, output),
          mkEdge(material, interviewer),
          mkEdge(difficulty, scenario),
        ],
      };
    },
  },
  {
    name: "flow.template.hr.name",
    desc: "flow.template.hr.desc",
    build: () => {
      const scenario = mkNode("scenario", "HR 行为面试", 80, 200, {
        scenarioType: "single",
        sessionTitle: "HR 行为面试",
        description: "考察沟通、协作、领导力等软技能",
      });
      const interviewer = mkNode("interviewer", "HR 面试官", 340, 200, {
        role: "hr",
        tone: "gentle",
      });
      const model = mkNode("model", "LLM 模型", 600, 200, {});
      const output = mkNode("output", "启动面试", 860, 200, {
        outputType: "start_interview",
      });
      const difficulty = mkNode("difficulty", "难度", 80, 60, {
        level: 4,
        duration: 30,
      });
      return {
        nodes: [scenario, interviewer, model, output, difficulty],
        edges: [
          mkEdge(scenario, interviewer),
          mkEdge(interviewer, model),
          mkEdge(model, output),
          mkEdge(difficulty, scenario),
        ],
      };
    },
  },
  {
    name: "flow.template.group.name",
    desc: "flow.template.group.desc",
    build: () => {
      const scenario = mkNode("scenario", "群面场景", 80, 200, {
        scenarioType: "group",
        sessionTitle: "群面评估",
        description: "多面试官交叉评估多位候选人",
      });
      const i1 = mkNode("interviewer", "面试官 A", 340, 80, { role: "tech" });
      const i2 = mkNode("interviewer", "面试官 B", 340, 200, { role: "hr" });
      const i3 = mkNode("interviewer", "面试官 C", 340, 320, { role: "ceo" });
      const candidate = mkNode("candidate", "3 位候选人", 600, 80, {
        candidateCount: 3,
      });
      const model = mkNode("model", "LLM 模型", 600, 200, {});
      const output = mkNode("output", "综合评估", 860, 200, {
        outputType: "generate_report",
      });
      return {
        nodes: [scenario, i1, i2, i3, candidate, model, output],
        edges: [
          mkEdge(scenario, i1),
          mkEdge(scenario, i2),
          mkEdge(scenario, i3),
          mkEdge(i1, model),
          mkEdge(i2, model),
          mkEdge(i3, model),
          mkEdge(model, output),
        ],
      };
    },
  },
];
