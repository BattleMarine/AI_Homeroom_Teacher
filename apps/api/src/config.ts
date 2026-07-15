function getRequiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} 환경 변수가 필요합니다. 로컬 값은 docs/secrets/에만 기록합니다.`);
  }

  return value;
}

export function getApiServerConfig() {
  const portValue = getRequiredEnvironmentValue("API_PORT");
  const port = Number(portValue);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("API_PORT는 1부터 65535 사이의 정수여야 합니다.");
  }

  return {
    host: getRequiredEnvironmentValue("API_HOST"),
    port,
  };
}
