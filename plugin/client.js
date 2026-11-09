window.__ModuleLoader__.load({
  id: '@eatosin/dshify-plugin',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useState } = React;

    const NS = 'dshify.migrate';
    const EN = {
      tab: 'dshify migration',
      title: 'Migrate to DeepSeek Harness',
      subtitle:
        'Scan an OpenCode repository, then preview the DSH artifacts and the loss report. This panel is read-only.',
      repo: 'Repository path',
      repoHint: 'Leave empty to use the current workspace.',
      dest: 'Destination',
      destHint: 'Relative to the repository root.',
      presets: 'Emit the preset bundle (.dsh/harness)',
      scan: 'Scan',
      plan: 'Plan',
      check: 'Check',
      running: 'Running',
      error: 'Request failed',
      readOnly:
        'Apply is not available in this panel yet. Use the migrate_harness tool or /migrate apply in chat.',
      findings: 'Findings',
      artifacts: 'Artifacts',
      summary: 'Summary',
      none: 'none',
      raw: 'Raw JSON',
    };

    const palette = {
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      border: 'var(--dsw-alias-border-l1)',
      surface: 'var(--dsw-alias-bg-layer-1)',
      surfaceAlt: 'var(--dsw-alias-bg-layer-2)',
      accent: 'var(--dsw-alias-brand-primary)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
    };

    const styles = {
      section: { display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '860px', width: '100%', color: palette.text },
      header: { display: 'flex', flexDirection: 'column', gap: '4px' },
      title: { margin: 0, fontSize: '17px', fontWeight: 600 },
      subtitle: { margin: 0, color: palette.muted, fontSize: '13px', lineHeight: '20px' },
      card: {
        display: 'flex', flexDirection: 'column', gap: '12px', padding: '14px',
        border: `0.5px solid ${palette.border}`, borderRadius: '12px', background: palette.surface,
      },
      row: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
      field: { display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 220px', minWidth: '180px' },
      label: { fontSize: '12px', fontWeight: 600 },
      hint: { fontSize: '11px', color: palette.muted },
      input: {
        font: 'inherit', fontSize: '13px', padding: '7px 9px', color: palette.text,
        background: palette.surfaceAlt, border: `0.5px solid ${palette.border}`, borderRadius: '8px',
        outline: 'none',
      },
      checkbox: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', color: palette.muted },
      buttons: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
      button: {
        font: 'inherit', fontSize: '13px', padding: '7px 14px', borderRadius: '8px', cursor: 'pointer',
        color: palette.text, background: palette.surfaceAlt, border: `0.5px solid ${palette.border}`,
      },
      primary: { background: palette.accent, color: '#fff', border: 'none' },
      banner: { padding: '9px 12px', borderRadius: '8px', fontSize: '12px', lineHeight: '18px' },
      chips: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
      chip: {
        padding: '4px 9px', borderRadius: '999px', fontSize: '11px',
        background: palette.surfaceAlt, color: palette.muted, border: `0.5px solid ${palette.border}`,
      },
      list: { display: 'flex', flexDirection: 'column', gap: '6px', margin: 0, padding: 0, listStyle: 'none' },
      item: {
        display: 'flex', gap: '8px', alignItems: 'baseline', padding: '7px 9px',
        borderRadius: '8px', background: palette.surfaceAlt, fontSize: '12px',
      },
      code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px', color: palette.muted },
      pre: {
        margin: 0, padding: '10px', borderRadius: '8px', background: palette.surfaceAlt,
        fontSize: '11px', overflow: 'auto', maxHeight: '260px', color: palette.muted,
      },
    };

    const severityColor = (severity) =>
      severity === 'error' ? palette.error : severity === 'warning' ? palette.warn : palette.muted;

    async function request(body) {
      const response = await fetch('/api/dshify/migrate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({ ok: false, error: 'invalid response' }));
      if (!response.ok || payload.ok !== true) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'request failed');
      }
      return payload.result;
    }

    function Field({ label, hint, value, placeholder, onChange }) {
      return h('label', { style: styles.field },
        h('span', { style: styles.label }, label),
        h('input', {
          style: styles.input, value, placeholder, spellCheck: false,
          onChange: (event) => onChange(event.target.value),
        }),
        hint === undefined ? null : h('span', { style: styles.hint }, hint),
      );
    }

    function Summary({ result, t }) {
      const entries = Object.entries(result.summary ?? {}).filter(([, value]) => typeof value === 'number');
      if (entries.length === 0) return null;
      return h('div', { style: styles.chips },
        entries.map(([key, value]) => h('span', { key, style: styles.chip }, `${key}: ${value}`)),
        h('span', { style: styles.chip }, `${t('artifacts')}: ${(result.artifacts ?? []).length}`),
      );
    }

    function Findings({ findings, t }) {
      if (!Array.isArray(findings) || findings.length === 0) return null;
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('div', { style: styles.label }, t('findings')),
        h('ul', { style: styles.list },
          findings.slice(0, 40).map((finding, index) =>
            h('li', { key: `${finding.code}-${index}`, style: styles.item },
              h('span', { style: { ...styles.code, color: severityColor(finding.severity), fontWeight: 600 } }, finding.code),
              h('span', { style: { color: palette.muted } }, finding.severity ?? 'info'),
              finding.path === undefined ? null : h('span', { style: styles.code }, finding.path),
            ),
          ),
        ),
      );
    }

    function Artifacts({ artifacts, t }) {
      if (!Array.isArray(artifacts) || artifacts.length === 0) return null;
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('div', { style: styles.label }, t('artifacts')),
        h('ul', { style: styles.list },
          artifacts.slice(0, 40).map((artifact, index) =>
            h('li', { key: `${artifact.path}-${index}`, style: styles.item },
              h('span', { style: styles.code }, artifact.path),
              h('span', { style: styles.chip }, artifact.capability),
              artifact.status === undefined ? null : h('span', { style: styles.chip }, artifact.status),
            ),
          ),
        ),
      );
    }

    function Panel({ t }) {
      const [repo, setRepo] = useState('');
      const [dest, setDest] = useState('.dsh');
      const [presets, setPresets] = useState(false);
      const [running, setRunning] = useState('');
      const [result, setResult] = useState(null);
      const [error, setError] = useState('');

      const run = useCallback(async (action) => {
        setRunning(action);
        setError('');
        try {
          const body = { action, dest: dest.trim() === '' ? undefined : dest.trim(), presets };
          if (repo.trim() !== '') body.path = repo.trim();
          setResult(await request(body));
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught));
          setResult(null);
        } finally {
          setRunning('');
        }
      }, [repo, dest, presets]);

      const busy = running !== '';
      const button = (action, primary = false) =>
        h('button', {
          key: action,
          type: 'button',
          style: { ...styles.button, ...(primary ? styles.primary : {}), opacity: busy ? 0.6 : 1 },
          disabled: busy,
          onClick: () => run(action),
        }, running === action ? `${t('running')} ${action}…` : t(action));

      return h('section', { style: styles.section },
        h('div', { style: styles.header },
          h('h2', { style: styles.title }, t('title')),
          h('p', { style: styles.subtitle }, t('subtitle')),
        ),
        h('div', { style: styles.card },
          h('div', { style: styles.row },
            h(Field, { label: t('repo'), hint: t('repoHint'), value: repo, placeholder: 'current workspace', onChange: setRepo }),
            h(Field, { label: t('dest'), hint: t('destHint'), value: dest, placeholder: '.dsh', onChange: setDest }),
          ),
          h('label', { style: styles.checkbox },
            h('input', { type: 'checkbox', checked: presets, onChange: (event) => setPresets(event.target.checked) }),
            t('presets'),
          ),
          h('div', { style: styles.buttons }, button('scan', true), button('plan'), button('check')),
        ),
        error === ''
          ? null
          : h('div', { style: { ...styles.banner, color: palette.error, background: palette.surface } },
              `${t('error')}: ${error}`),
        result === null
          ? null
          : h('div', { style: styles.card },
              h('div', { style: styles.row },
                h('strong', { style: { fontSize: '13px' } }, `dshify ${result.action}`),
                h('span', { style: { ...styles.chip, color: result.ok ? palette.ok : palette.warn } },
                  result.ok ? 'ok' : 'needs attention'),
                h('span', { style: styles.code }, result.root ?? ''),
              ),
              h(Summary, { result, t }),
              h(Findings, { findings: result.findings, t }),
              h(Artifacts, { artifacts: result.artifacts, t }),
              h('details', null,
                h('summary', { style: { ...styles.hint, cursor: 'pointer' } }, t('raw')),
                h('pre', { style: styles.pre }, JSON.stringify(result, null, 2)),
              ),
            ),
        h('p', { style: styles.subtitle }, t('readOnly')),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'dshify migration: dictionary');
        const t = ctx.locale.bind(NS);
        ctx.slots.inject('settings.plugins.tab', () =>
          ctx.slots.register(
            { name: 'settings.plugins.tab', id: 'dshify', order: 30, label: () => t('tab') },
            (props) => h(Panel, { ...props, t }),
          ),
        );
      },
    };
  },
});
