module.exports = {
  apps: [{
    name: 'smart-companion',
    script: 'server.js',
    cwd: '/opt/smart-companion',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 8000,
      // 如果有阿里云百炼 API Key，可以直接放这里
      // LLM_API_KEY: '你的阿里云百炼 API Key',
      // LLM_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      // LLM_PROTOCOL: 'openai',
    },
    error_file: '/opt/smart-companion/logs/error.log',
    out_file: '/opt/smart-companion/logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    kill_timeout: 3000,
  }],
};
