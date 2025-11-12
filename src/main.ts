import Dockerode from "dockerode";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const docker = new Dockerode();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function getRunningContainers() {
  const containers = await docker.listContainers({ all: true });
  return containers
    .filter((container) => container.State === "running")
    .map((container) => ({
      Id: container.Id,
      Names: container.Names,
      Image: container.Image,
    }));
}

async function findContainer(containerIdentifier: string) {
  const runningContainers = await getRunningContainers();
  return runningContainers.find(
    (container) =>
      container.Id.startsWith(containerIdentifier) ||
      container.Names.some(
        (name) =>
          name === `/${containerIdentifier}` || name === containerIdentifier,
      ),
  );
}

async function copyFileToContainer(
  containerId: string,
  localPath: string,
  remotePath: string,
) {
  const container = docker.getContainer(containerId);
  const fileContent = readFileSync(localPath, "utf-8");

  // Create directory if it doesn't exist
  const remoteDir = remotePath.substring(0, remotePath.lastIndexOf("/"));
  await executeCommandInContainer(containerId, ["mkdir", "-p", remoteDir]);

  // Write file content to container
  const exec = await container.exec({
    Cmd: ["sh", "-c", `cat > ${remotePath}`],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({ hijack: true, stdin: true });

  return new Promise<void>((resolve, reject) => {
    stream.write(fileContent);
    stream.end();

    stream.on("end", async () => {
      // Wait a bit for the exec to finish and be inspectable
      await new Promise((r) => setTimeout(r, 100));

      const info = await exec.inspect();
      if (info.ExitCode !== 0 && info.ExitCode !== null) {
        reject(new Error(`Failed to copy file, exit code ${info.ExitCode}`));
      } else {
        resolve();
      }
    });
    stream.on("error", reject);
  });
}

async function executeCommandInContainer(
  containerId: string,
  command: string[],
) {
  const container = docker.getContainer(containerId);
  const exec = await container.exec({
    Cmd: command,
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({ hijack: true, stdin: false });

  return new Promise<void>((resolve, reject) => {
    stream.on("end", async () => {
      // Wait a bit for the exec to finish and be inspectable
      await new Promise((r) => setTimeout(r, 100));

      const info = await exec.inspect();
      if (info.ExitCode !== 0 && info.ExitCode !== null) {
        reject(new Error(`Command failed with exit code ${info.ExitCode}`));
      } else {
        resolve();
      }
    });
    stream.on("error", reject);
  });
}

function delegateToDockerExec(containerId: string) {
  const dockerExec = spawn(
    "docker",
    ["exec", "-i", containerId, "sh", "/tmp/goose_bin/install.sh"],
    {
      stdio: "inherit",
    },
  );

  dockerExec.on("error", (error) => {
    console.error("Error executing docker exec:", error);
    process.exit(1);
  });

  dockerExec.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

async function main() {
  const containerIdentifier = process.argv[2];

  if (!containerIdentifier) {
    console.error("Error: Container name or ID is required as an argument.");
    process.exit(1);
  }

  const container = await findContainer(containerIdentifier);

  if (!container) {
    console.error(
      `Error: Container ${containerIdentifier} is not running or does not exist.`,
    );
    process.exit(1);
  }

  const containerId = container.Id;
  const installScriptPath = join(__dirname, "install.sh");
  const remoteScriptPath = "/tmp/goose_bin/install.sh";

  try {
    await copyFileToContainer(containerId, installScriptPath, remoteScriptPath);
    await executeCommandInContainer(containerId, [
      "chmod",
      "+x",
      remoteScriptPath,
    ]);
  } catch (error) {
    console.error("Failed to setup container:", error);
    process.exit(1);
  }

  // Delegate to docker exec - this will take over stdin/stdout/stderr
  delegateToDockerExec(containerId);
}

main();
