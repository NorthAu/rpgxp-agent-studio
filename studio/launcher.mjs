import { createInterface } from 'node:readline/promises';
import { join, resolve } from 'node:path';
import { readJson } from './compile.mjs';
import {
  buildProject, checkProject, getProject, install, launchProject, listProjects,
  packageProject, prepareOfflineRuntime, rtp, sample, withProjectLock, workspace,
} from './project.mjs';
import { playtest } from './playtest.mjs';

process.env.RPGMAKER_RTP_PATH = rtp;
const print = value => console.log(JSON.stringify(value, null, 2));
const owned = (id, task) => withProjectLock(id, () => task(id));

async function demo(id) {
  return owned(id, async () => {
    const specification = await readJson(sample);
    const { route } = await readJson(join(workspace, 'lighthouse-playtest.json'));
    print(await buildProject(id, specification));
    console.log('正在用原版 RGSS1 测试通关，请保持游戏窗口运行。');
    const verification = await playtest(id, route);
    print(verification);
    if (!verification.ok) throw new Error(`试玩未通过，请查看 ${verification.report}`);
    print(await packageProject(id));
  });
}

async function menu() {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async message => (await input.question(message)).trim().replace(/^"(.*)"$/, '$1');
  const gameId = () => ask('工程 ID（英文小写、数字或连字符）> ');
  console.log(`RPG Maker XP 制作器\nXP 运行库 ${install}\n工作目录 ${workspace}`);
  try {
    while (true) {
      console.log('\n1 生成 JSON 游戏工程\n2 构建、通关并打包内置示例\n3 查看工程\n4 在非 Steam 版 RPG Maker XP 打开工程\n5 启动游戏\n6 检查工程并打包\n7 测试工程能否进入新游戏\n8 准备本机离线运行库\n0 退出');
      const choice = await ask('选择> ');
      try {
        switch (choice) {
          case '0':
            return;
          case '1': {
            const spec = await readJson(resolve(await ask('游戏规格 JSON 路径> ')));
            print(await owned(await gameId(), id => buildProject(id, spec)));
            break;
          }
          case '2':
            await demo(await gameId());
            break;
          case '3':
            print(await listProjects());
            break;
          case '4':
          case '5':
            print(await owned(await gameId(), id => launchProject(id, choice === '4')));
            break;
          case '6':
            await owned(await gameId(), async id => {
              const report = await checkProject(await getProject(id));
              print(report);
              if (report.ok) print(await packageProject(id));
            });
            break;
          case '7':
            print(await owned(await gameId(), id => playtest(id)));
            break;
          case '8': {
            const from = await ask('XP 安装目录（留空自动查找）> ');
            const assets = await ask('独立 RTP 目录（留空自动查找）> ');
            print(await prepareOfflineRuntime(from || undefined, assets || undefined));
            console.log('下次打开菜单将使用本机离线运行库。');
            break;
          }
          default:
            console.log('请输入 0–8。');
        }
      } catch (error) {
        console.error(error.message);
      }
    }
  } finally {
    input.close();
  }
}

try {
  if (process.argv[2] === 'demo') await demo(process.argv[3] ?? 'lighthouse');
  else if (process.argv[2] === 'cache-runtime') print(await prepareOfflineRuntime(process.argv[3], process.argv[4]));
  else await menu();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
