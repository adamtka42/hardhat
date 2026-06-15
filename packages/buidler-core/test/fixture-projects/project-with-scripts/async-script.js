setTimeout(() => {
  if (global.config === undefined || global.config.hyperion === undefined) {
    process.exit(123);
  }
}, 100);
