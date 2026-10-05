import { describe, expect, it } from 'vitest';
import { createProject } from '../src/domain';
import { createStoryProposal, ruleBasedStoryGenerator } from '../src/generators';
describe('provider boundary',()=>{
 it('returns reviewable rule proposals without changing the live project',async()=>{const p=createProject({size:64}),original=JSON.stringify(p);const result=await createStoryProposal(ruleBasedStoryGenerator,'开场说：“跟我走。” 8 秒后移动。',p);expect(result.generatorKind).toBe('rules');expect(result.sourceRevision).toBe(p.updatedAt);expect(result.nodes.length).toBeGreaterThan(0);expect(JSON.stringify(p)).toBe(original);});
 it('honors cancellation before invoking a provider',async()=>{const controller=new AbortController();controller.abort();await expect(createStoryProposal(ruleBasedStoryGenerator,'对白',createProject(),controller.signal)).rejects.toThrow();});
});
