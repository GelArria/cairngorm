process.stdout.write("first chunk\n");
setTimeout(
  () => {
    process.stderr.write("second chunk\n");
    process.exit(Number(process.argv[2] ?? 0));
  },
  Number(process.argv[3] ?? 250),
);
