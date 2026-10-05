import { generateStory, validateProject } from './domain';
import type { Project, StoryNode } from './types';

/** Provider-independent boundary. Implementations return proposals, never mutate live projects. */
export interface StoryGenerator {
  readonly id: string;
  readonly label: string;
  readonly kind: 'rules' | 'language-model';
  generate(input: { text: string; project: Readonly<Project>; signal?: AbortSignal }): Promise<{ nodes: StoryNode[]; notes: string[] }>;
}
export const ruleBasedStoryGenerator: StoryGenerator = {
  id: 'local-story-rules-v1', label: '离线规则模板', kind: 'rules',
  async generate({text,project,signal}) {
    signal?.throwIfAborted();
    return {nodes:generateStory(text,project as Project),notes:['有限关键词规则；不调用语言模型。']};
  },
};
export async function createStoryProposal(generator: StoryGenerator, text: string, project: Project, signal?: AbortSignal) {
  const sourceRevision=project.updatedAt;
  const result=await generator.generate({text,project:structuredClone(project),signal});
  signal?.throwIfAborted();
  const diagnostics=validateProject({...project,story:[...project.story,...result.nodes]});
  return {...result,sourceRevision,generatorId:generator.id,generatorKind:generator.kind,diagnostics};
}
