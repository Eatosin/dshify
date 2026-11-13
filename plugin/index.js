/**
 * dshify migration plugin for DeepSeek Harness.
 *
 * Host half: the model-facing `migrate_harness` tool, the human `/migrate`
 * command, and the read-only Web settings route used by client.js. All work
 * happens in @eatosin/dshify, the offline engine.
 */
import {
  ACTIONS,
  formatResult,
  parseCommand,
  runAction,
  validateInput,
} from './migrate.js';

export const name = 'dshify';
export const inject = ['tools'];

const TOOL_DESCRIPTION =
  'Port an OpenCode repository to a DeepSeek Harness (DSH) surface. ' +
  'Actions: "scan" lists the source skills, commands, personas and MCP servers (read-only); ' +
  '"plan" shows the DSH artifacts, findings and losses (read-only); ' +
  '"apply" writes .dsh/ and .dshify.lock.json (writes files; use a test branch); ' +
  '"check" verifies the files, the lockfile and DSH discovery (read-only). ' +
  'apply never deletes user files and refuses to overwrite files it does not own. ' +
  'With presets, "delegation" emits a parent preset with model-routed child tools; ' +
  '"presetPrefix" namespaces preset ids; "modelMap" maps persona id to {provider, model, tool}.';

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ACTIONS, description: 'Action that ran.' },
    ok: { type: 'boolean', description: 'True when the action found no blocking problem.' },
    root: { type: 'string', description: 'Absolute repository root.' },
    exitCode: { type: 'integer', description: '0, 3 (drift or conflict) or 4 (verification failed).' },
    summary: { type: 'object', additionalProperties: true, description: 'Counts for the action.' },
    findings: { type: 'array', items: { type: 'object', additionalProperties: true } },
    artifacts: { type: 'array', items: { type: 'object', additionalProperties: true } },
    verification: { type: 'object', additionalProperties: true },
  },
  required: ['action', 'ok', 'root'],
};

const TOOL = {
  name: 'migrate_harness',
  description: TOOL_DESCRIPTION,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ACTIONS, description: 'scan, plan, apply or check.' },
      path: {
        type: 'string',
        description: 'Repository path. A relative path resolves from the working directory. Default: ".".',
      },
      dest: { type: 'string', description: 'Destination tree inside the repository. Default: ".dsh".' },
      presets: {
        type: 'boolean',
        description: 'Also emit the .dsh/harness/ preset bundle (persona and MCP rows).',
      },
      force: {
        type: 'boolean',
        description: 'Replace human-edited artifacts during apply. Use with care.',
      },
      delegation: {
        type: 'boolean',
        description:
          'Emit a parent preset with one model-routed subagent tool per persona. Requires presets.',
      },
      presetPrefix: {
        type: 'string',
        description:
          'Namespace for generated preset ids, for example "agency-". Keeps several repositories installable in one profile.',
      },
      modelMap: {
        type: 'object',
        additionalProperties: true,
        description:
          'Persona id to { provider, model, tool }. Both provider and model are required together. Tool defaults to subagent_<persona>.',
      },
      extraPlugins: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Bundle-local plugin specifiers to add to the preset, relative to cordis.patch.yml (for example "./tools/index.js"). The plugin file is user-authored; dshify never writes it.',
      },
    },
    required: ['action'],
  },
  output: {
    schema: OUTPUT_SCHEMA,
    render(_args, value) {
      return [{ type: 'text', text: formatResult(value) }];
    },
  },
  presentCall(args) {
    const action = typeof args?.action === 'string' ? args.action : 'migration';
    return { card: 'generic', title: `dshify ${action}`, kind: 'other', rawInput: args };
  },
  async execute(rawArgs) {
    return await runAction(validateInput(rawArgs));
  },
};

const COMMAND = {
  name: 'migrate',
  description: 'Port an OpenCode repository to DSH (scan, plan, apply, check).',
  handler: async (invocation) => {
    try {
      return {
        kind: 'success',
        text: formatResult(await runAction(parseCommand(invocation.rawInput))),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: 'error', text: message };
    }
  },
};

/**
 * Register the tool, the command (when present), and the read-only Web route.
 * @param {object} ctx - Cordis context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(TOOL));

  const commands = typeof ctx.get === 'function' ? ctx.get('commands') : undefined;
  if (commands !== undefined && typeof commands.register === 'function') {
    ctx.effect(() => commands.register(COMMAND));
  }

  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined;
  if (webServer !== undefined && typeof webServer.register === 'function') {
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/api/dshify/migrate',
        handler: makeHandler(ctx),
      }),
    );
  }
}

/** Read-only JSON route for the Web settings panel. Apply stays in the tool. */
function makeHandler(ctx) {
  return async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(payload));
    };

    if (req.method !== 'POST') {
      send(405, { ok: false, error: 'use POST' });
      return;
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 65_536) {
        send(413, { ok: false, error: 'request body is larger than 64 KiB' });
        req.destroy();
        return;
      }
    }

    let raw;
    try {
      raw = JSON.parse(body === '' ? '{}' : body);
    } catch {
      send(400, { ok: false, error: 'request body must be JSON' });
      return;
    }

    let input;
    try {
      input = validateInput(raw);
    } catch (error) {
      send(400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }

    if (input.action === 'apply') {
      send(403, {
        ok: false,
        error: 'apply is not available from this panel; use the migrate_harness tool or /migrate apply',
      });
      return;
    }

    const working = typeof ctx.get === 'function' ? ctx.get('workingDirectory') : undefined;
    const defaultPath =
      typeof working?.defaultDirectory === 'string' ? working.defaultDirectory : process.cwd();

    try {
      const result = await runAction({ ...input, path: input.path ?? defaultPath });
      send(200, { ok: true, result });
    } catch (error) {
      send(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}
