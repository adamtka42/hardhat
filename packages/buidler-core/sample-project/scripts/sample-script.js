async function main() {
  const [from] = await network.provider.send("qrl_accounts");
  const Sample = await qrl.getContractFactory("Sample");
  const deployment = await Sample.deploy({ from });
  const sample = await qrl.getContractAt("Sample", deployment.address);

  const txHash = await sample.functions.store(42, { from });
  await qrl.waitForTransaction(txHash);
  const [stored] = await sample.callStatic.retrieve();

  console.log("Sample deployed to:", deployment.address);
  console.log("Stored value:", stored.toString(10));
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
