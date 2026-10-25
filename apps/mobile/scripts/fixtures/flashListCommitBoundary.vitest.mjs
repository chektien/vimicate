// Negative controls for the patched FlashList commit boundary. The default mode
// runs the app-suite regression itself. FLASHLIST_COMMIT_PROBE_MODE selects an
// in-memory control that removes one part of the repair. No installed package
// or production patch is edited. A control that no longer matches the
// installed source fails instead of silently testing the unmodified repair.
const controls = {
  // Restores render-phase manager mutation, the installed 2.3.2 behaviour.
  'render-mutation': ['/recyclerview/hooks/useRecyclerViewManager.js', [[
    'useMemo(() => recyclerViewManager.project(props),',
    'useMemo(() => { const changed = props.data !== recyclerViewManager.props.data; recyclerViewManager.updateProps(props); if (changed) recyclerViewManager.processDataUpdate(); return recyclerViewManager; },',
  ]]],
  // Native layout events use the rendered closure instead of the committed assignment.
  'closure-index': ['/recyclerview/ViewHolder.js', [[
    'const assignment = committedAssignment.current;',
    'const assignment = { index, onSizeChanged };',
  ], [
    'event.nativeEvent.layout);\n    }, []);',
    'event.nativeEvent.layout);\n    }, [index, onSizeChanged]);',
  ]]],
  // Restores the children memo that omits the index passed to renderItem.
  'stale-render-index': ['/recyclerview/ViewHolder.js', [[
    '}, [item, index, extraData, target, renderItem]);',
    '}, [item, extraData, target, renderItem]);',
  ]]],
  // Ignores a replay that saw newer accepted state than the committed render.
  'no-divergence': ['/recyclerview/RecyclerView.js', [[
    'const renderOutputDiverged = recyclerViewManager.consumeRenderOutputDivergence();',
    'const renderOutputDiverged = (recyclerViewManager.consumeRenderOutputDivergence(), false);',
  ]]],
  // Restores the library's truncation-only stale measurement filter.
  'no-stale-filter': ['/recyclerview/layout-managers/LayoutManager.js', [[
    '        }\n        // layoutInfo may contain stale indices from ViewHolders that were rendered\n        // before the data shrunk, including after an earlier pass truncated layouts.\n        // eslint-disable-next-line no-param-reassign\n        layoutInfo = layoutInfo.filter((info) => info.index < totalItemCount);',
    '            layoutInfo = layoutInfo.filter((info) => info.index < totalItemCount);\n        }',
  ]]],
};
const mode = process.env.FLASHLIST_COMMIT_PROBE_MODE;
if (mode && !controls[mode]) throw new Error(`unknown FLASHLIST_COMMIT_PROBE_MODE ${mode}`);

export default {
  plugins: mode ? [{
    name: `flash-list-negative-control-${mode}`,
    enforce: 'pre',
    transform(source, id) {
      const [suffix, replacements] = controls[mode];
      if (!id.endsWith(suffix)) return;
      return replacements.reduce((next, [from, to]) => {
        if (!next.includes(from)) throw new Error(`negative control ${mode} no longer matches ${suffix}`);
        return next.replace(from, to);
      }, source);
    },
  }] : [],
  test: { include: ['src/transcript/flashListCommitBoundary.test.tsx', 'src/transcript/flashListCommitAuthority.test.tsx'] },
};
