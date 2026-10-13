// 每次只运行一个任务；输入更新后丢弃旧结果，再处理最新内容。
export function createAutoCompare({ compare, onResult, onError, delay = 350 }) {
  let revision = 0;
  let timer;
  let running = false;
  let requested = false;

  async function flush() {
    timer = undefined;
    if (running || !requested) return;
    requested = false;
    running = true;
    const current = revision;
    try {
      const result = await compare();
      if (current === revision && result !== null) onResult(result);
    } catch (error) {
      if (current === revision) onError(error);
    } finally {
      running = false;
      if (requested && timer === undefined) timer = setTimeout(flush, delay);
    }
  }

  return {
    schedule() {
      revision++;
      requested = true;
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
  };
}
