export async function requestJSON(url, options = {}, fetcher = fetch) {
  let response;
  try { response = await fetcher(url, { ...options, signal: options.signal ?? AbortSignal.timeout(30000) }); }
  catch {
    throw new Error('网络暂时不可用。输入仍保留；保存是否完成需刷新核对，再重试。');
  }
  const result = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403 || response.redirected) {
    const error = new Error('登录状态已失效，请重新登录。未保存的输入仍留在当前页面。');
    error.status = 401;
    throw error;
  }
  if (!response.ok || !result) {
    const error = new Error(result?.error || '服务暂时不可用，请稍后重试。');
    error.status = response.status;
    throw error;
  }
  return result;
}
