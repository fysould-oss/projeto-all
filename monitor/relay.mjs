const onlineEndpoint = 'https://projeto-all-condoconnect.sunnyode3.chatgpt.site/api/activity';

export function startOnlineRelay(getSnapshot, credential) {
  if (!credential) return () => {};
  let busy = false;
  let lastPayload = '';
  let lastSent = 0;
  let lastStatus;
  const controller = new AbortController();
  async function transmit() {
    if (busy || controller.signal.aborted) return;
    busy = true;
    try {
      const snapshot = getSnapshot();
      if (snapshot.status === 'starting') return;
      const projects = snapshot.projects.slice(0, 25).map(project => ({
        ...project,
        agents: project.agents.slice(0, 20).map(agent => ({
          ...agent,
          chat: agent.chat?.slice(-5),
          events: agent.events?.slice(-8),
        })),
      }));
      let body = JSON.stringify({ status: snapshot.status, projects });
      if (Buffer.byteLength(body) > 480_000) {
        body = JSON.stringify({ status: snapshot.status, projects: projects.map(project => ({
          ...project, agents: project.agents.map(agent => ({ ...agent, chat: agent.chat?.slice(-1) })),
        })) });
      }
      if (Buffer.byteLength(body) > 500_000 || (body === lastPayload && Date.now() - lastSent < 30_000)) return;
      const result = await fetch(onlineEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'OAI-Sites-Authorization': 'Bearer ' + credential,
          'X-Office-Sync': '1',
        },
        redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        body,
      });
      if (result.ok) {
        lastPayload = body;
        lastSent = Date.now();
      }
      if (lastStatus !== result.status) console.log(result.ok ? 'Atividade privada sincronizada.' : 'Sincronização retornou HTTP ' + result.status);
      lastStatus = result.status;
    } catch {
      if (lastStatus !== 0 && !controller.signal.aborted) console.log('Sincronização privada temporariamente indisponível.');
      lastStatus = 0;
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(transmit, 5000);
  timer.unref();
  return () => {
    clearInterval(timer);
    controller.abort();
  };
}
