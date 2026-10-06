import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import ElevationLegend from '../src/ElevationLegend';
describe('native-level legend disclosure',()=>{
 it('names editor bounds and map-specific min/max separately',()=>{const html=renderToStaticMarkup(<ElevationLegend minimum={2} maximum={9}/>);expect(html).toContain('编辑范围 0–16 级');expect(html).toContain('地图最低');expect(html).toContain('<b>2</b>');expect(html).toContain('地图最高');expect(html).toContain('<b>9</b>');expect(html).toContain('非米制');});
 it('shows pointer and target levels without calling them meters',()=>{const html=renderToStaticMarkup(<ElevationLegend minimum={0} maximum={16} current={6} target={8}/>);expect(html).toContain('<b>6</b>');expect(html).toContain('8 级');expect(html).not.toContain('米高');expect(html).toContain('left:37.5%');});
 it('does not fabricate a current height when pointer is absent',()=>{expect(renderToStaticMarkup(<ElevationLegend minimum={0} maximum={0}/>)).toContain('<b>—</b>');});
});
