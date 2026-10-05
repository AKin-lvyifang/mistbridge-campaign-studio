import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../src/App';
describe('initial workbench render',()=>{
 it('renders the functional shell with truthful compatibility labels',()=>{const html=renderToStaticMarkup(React.createElement(App));expect(html).toContain('可编辑等距地图');expect(html).toContain('示意预览');expect(html).toContain('剧情触发');expect(html).toContain('导出场景');expect(html).toContain('尚未进行游戏内测试');expect(html).not.toContain('undefined');});
});
