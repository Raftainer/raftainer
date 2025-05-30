import Pino from "pino";

export const logger = Pino({
  transport: {
    targets: [
      {
        target: 'pino/file',
        level: 'debug',
        options: {
          destination: './debug.log'
        }
      }
    ]
  }
});
