/** Authentication follows any successful API response, independently of metrics. */
export async function readDashboardResponse(
  response: Response,
  setAuthenticationRequired: (required: boolean) => void,
) {
  if (response.status === 401) {
    setAuthenticationRequired(true);
    throw new Error("Требуется токен доступа");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || "Ошибка запроса");
  setAuthenticationRequired(false);
  return data;
}
