import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { constants } from 'node:fs';
import { copyFile, readFile, stat } from 'node:fs/promises';
import { join, basename, extname, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { assert, readJson } from './compile.mjs';
import {
  authoringGuide, sample, getProject, listProjects, initProject, buildProject, checkProject,
  packageProject, launchProject, projectId, withProjectLock, rtp, workspace,
} from './project.mjs';
import { playtest } from './playtest.mjs';
import { exportWeb } from './web-export.mjs';

process.env.RPGMAKER_RTP_PATH = rtp;
const nativeEntry = createRequire(import.meta.url).resolve('rpgmaker-xp-mcp');
const profile = { name: 'rpgxp-agent-studio', version: '1.0.0' };
const text = (description) => ({ type: 'string', description });
const obj = (description) => ({ type: 'object', description });
const projectField = { project: text('Project ID under the Studio projects directory') };
const definition = (name, description, properties = {}, required = []) =>
  ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
const custom = [
  definition('studio_guide', 'Read the workflow and JSON specification with complete working example paths. Call this first.'),
  definition('studio_projects', 'List native XP projects managed by Agent Studio.'),
  definition('studio_init', 'Create a new editable XP project with the installed template and local runtime assets.', { ...projectField, title: text('Optional ASCII window title') }, ['project']),
  definition('studio_build', 'Compile a complete JSON specification into a new native XP project. Use spec or specFile. Existing projects are preserved.',
    { ...projectField, spec: obj('Version 1 game specification'), specFile: text('Absolute path to a UTF-8 JSON specification') }, ['project']),
  definition('studio_check', 'Parse maps and check player spawn, tileset references, event terminators, transfer bounds and standard database asset references.', projectField, ['project']),
  definition('studio_playtest', 'Run original Windows RGSS on an isolated project copy, feed scripted movement and choices and return runtime assertions. Without a route, verify New Game loads.',
    { ...projectField, route: { type: 'array', items: { type: 'object' } }, timeoutSeconds: { type: 'integer', minimum: 5, maximum: 180 } }, ['project']),
  definition('studio_import_asset', 'Copy a PNG/JPEG or audio file into an existing XP asset category. Returns the name used in database fields.',
    { ...projectField, source: text('Absolute path to the local asset'), category: text('For example Graphics/Characters, Graphics/Titles, Audio/BGM') }, ['project', 'source', 'category']),
  definition('studio_package', 'Validate and create a standalone Windows ZIP with local runtime assets. Release ZIPs are stored in the workspace dist directory.',
    { ...projectField, revision: text('Optional ASCII revision suffix, default release') }, ['project']),
  definition('studio_export_web', 'Compile a compatible JSON specification to an offline browser game in dist. Use a new output ID. This export supports the demo terrain skin and native-like map events.',
    { output: text('New output ID'), specFile: text('Absolute path to a UTF-8 JSON specification') }, ['output','specFile']),
  definition('studio_launch', 'Open the game or original RPG Maker XP editor window.',
    { ...projectField, editor: { type: 'boolean', description: 'Open Game.rxproj when true' } }, ['project']),
];

async function upstream(project, operate) {
  const client = new Client(profile);
  const transport = new StdioClientTransport({
    command: process.execPath, args: [nativeEntry],
    env: { RPGMAKER_PROJECT_PATH: project, RPGMAKER_RTP_PATH: rtp },
    stderr: 'ignore',
  });
  try {
    await client.connect(transport);
    return await operate(client);
  } finally {
    await client.close();
  }
}

async function importAsset(args) {
  const project = await getProject(args.project);
  assert(typeof args.source === 'string' && isAbsolute(args.source), 'source must be an absolute filepath');
  assert(/^(Graphics\/(Animations|Autotiles|Battlebacks|Battlers|Characters|Fogs|Gameovers|Icons|Panoramas|Pictures|Tilesets|Titles|Transitions|Windowskins)|Audio\/(BGM|BGS|ME|SE))$/.test(args.category), 'Unknown XP asset category');
  const name = basename(args.source);
  const ext = extname(name);
  const accepted = args.category.startsWith('Graphics/') ? /^(\.png|\.jpe?g)$/i : /^(\.ogg|\.wav|\.mid|\.mp3|\.wma)$/i;
  assert(accepted.test(ext) && (await stat(args.source)).isFile(), 'File does not match the selected XP asset category');
  const destination = join(project, args.category, name);
  await copyFile(args.source, destination, constants.COPYFILE_EXCL);
  return { asset: basename(name, ext), path: destination };
}

async function execute(name, args = {}) {
  switch (name) {
    case 'studio_guide':
      return { workspace, sample, samplePlaytest: join(workspace, 'lighthouse-playtest.json'), guide: await readFile(authoringGuide, 'utf8') };
    case 'studio_projects':
      return listProjects();
    case 'studio_init':
      return initProject(args.project, args.title);
    case 'studio_build':
      assert(Boolean(args.spec) !== Boolean(args.specFile), 'Provide exactly one of spec or specFile');
      assert(!args.specFile || isAbsolute(args.specFile), 'specFile must be an absolute path');
      return buildProject(args.project, args.spec ?? await readJson(args.specFile));
    case 'studio_check':
      return checkProject(await getProject(args.project));
    case 'studio_playtest':
      return playtest(args.project, args.route, args.timeoutSeconds);
    case 'studio_import_asset':
      return importAsset(args);
    case 'studio_package':
      return packageProject(args.project, args.revision);
    case 'studio_export_web':
      assert(typeof args.specFile === 'string' && isAbsolute(args.specFile), 'specFile must be an absolute path');
      return exportWeb(await readJson(args.specFile),join(workspace,'dist',projectId(args.output)));
    case 'studio_launch':
      return launchProject(args.project, args.editor === true);
    default: {
      const { project, ...nativeArgs } = args;
      const dir = await getProject(project);
      const result = await upstream(dir, client => client.callTool({ name, arguments: nativeArgs }));
      const response = result.content?.[0]?.text;
      assert(!result.isError && typeof response === 'string' && !response.startsWith('Error:'), response ?? 'Native XP tool failed');
      return JSON.parse(response);
    }
  }
}

async function call(name, args) {
  const task = () => execute(name, args);
  return args?.project ? withProjectLock(args.project, task) : task();
}

async function getTools() {
  const native = await upstream(workspace, client => client.listTools());
  // The native harness constructor creates projects through its own path mechanism.
  // Studio owns project creation so that all projects use the same runtime and staging.
  return [...custom, ...native.tools.filter(tool => tool.name !== 'create_tileset_identification_harness').map(tool => ({
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: { ...projectField, ...tool.inputSchema.properties },
      required: ['project', ...(tool.inputSchema.required ?? [])],
    },
  }))];
}

async function serve() {
  const tools = await getTools();
  const names = new Set(tools.map(tool => tool.name));
  const server = new Server(profile, {
    capabilities: { tools: {} },
    instructions: 'Author a playable native RPG Maker XP game. Start with studio_guide. Build or initialize a project, create and check maps and events, run an explicit native playthrough route, then package a Windows ZIP. The original editor may cache changes while open. Close it before Agent writes to the same project.',
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  let queue = Promise.resolve();
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const pending = queue.then(async () => {
      try {
        assert(names.has(params.name), `Unknown tool ${params.name}`);
        const data = await call(params.name, params.arguments);
        return { isError: data?.ok === false, content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error.message }] };
      }
    });
    queue = pending.catch(() => {});
    return pending;
  });
  await server.connect(new StdioServerTransport());
}

try {
  const [command, name, input] = process.argv.slice(2);
  if (command === 'mcp') {
    await serve();
  } else if (command === 'tools') {
    console.log(JSON.stringify(await getTools(), null, 2));
  } else if (command === 'call' && name) {
    const args = input?.startsWith('@') ? await readJson(input.slice(1)) : JSON.parse(input ?? '{}');
    assert((await getTools()).some(tool => tool.name === name), `Unknown tool ${name}`);
    const data = await call(name, args);
    console.log(JSON.stringify(data, null, 2));
    if (data?.ok === false) process.exitCode = 1;
  } else {
    console.log('RPGXP Agent Studio\n  studio.cmd tools\n  studio.cmd call studio_guide\n  studio.cmd call <tool> <JSON or @args.json>\n  studio.cmd mcp');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
