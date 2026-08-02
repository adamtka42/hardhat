task("example2", "example task", async (ret) => 28);

task("example", "example task", async (__, { run }) => run("example2"));

module.exports = {
  defaultNetwork: "custom",
  networks: {
    custom: {
      url: "http://localhost:8545",
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      accounts: [
        "0x0100002fa45cae7e96414b644715d0e29de4ca12864fe7d52f3260545ad7c280bd7ceee79627d99d3bf9a1bbb2bcd73d5be401",
      ],
    },
  },
  unknown: {
    asd: 123,
  },
};
