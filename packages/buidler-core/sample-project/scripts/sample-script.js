async function main() {
  const Sample = await qrl.getContractFactory("Sample");
  const sample = await Sample.deploy();

  const tx = await sample.store(42);
  await tx.wait();
  const stored = await sample.retrieve();

  console.log("Sample deployed to:", sample.address);
  console.log("Deployment transaction:", sample.deployTransactionHash);
  console.log("Stored value:", stored.toString(10));
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
