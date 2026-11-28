import { pathToFileURL } from 'node:url';
import { isAbsolute, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function prepareCoordinatorDispatch({ directory, executorModule, project, instruction } = {}) {
  if (Object.keys(process.env).some(key => /^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_COMMON_DIR|GIT_CONFIG.*|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES)$/i.test(key))) {
    throw new Error('Execute o servidor sem substituições locais de diretório ou configuração Git.');
  }
  if (typeof executorModule !== 'string' || !isAbsolute(executorModule)) {
    throw new TypeError('executorModule precisa ser um caminho absoluto aprovado.');
  }
  const projectPath = typeof project === 'string' ? project : project?.path;
  if (typeof projectPath !== 'string' || !isAbsolute(projectPath)) throw new TypeError('Projeto sem caminho.');
  if (typeof instruction !== 'string' || !instruction.trim()) throw new TypeError('Instrução vazia.');
  const trusted = await import(pathToFileURL(resolve(executorModule)).href);
  if (typeof trusted.openQueue !== 'function' || typeof trusted.enqueue !== 'function') {
    throw new TypeError('Executor aprovado não expõe openQueue/enqueue.');
  }
  const cwd = await realpath(projectPath);
  const { stdout } = await execute('git', ['rev-parse', '--show-toplevel'], {
    cwd, windowsHide: true, timeout: 5000, maxBuffer: 16 * 1024,
  });
  const root = await realpath(stdout.trim());
  const equal = process.platform === 'win32' ? root.toLowerCase() === cwd.toLowerCase() : root === cwd;
  if (!equal) throw new Error('O projeto precisa ser exatamente a raiz Git.');
  return async () => {
    const db = trusted.openQueue(directory);
    try {
      const id = await trusted.enqueue(db, cwd, instruction);
      if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new Error('O executor não confirmou o identificador da fila.');
      return id;
    } finally {
      db.close();
    }
  };
}
