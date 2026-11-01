import { describe, it, expect } from "vitest";
import {
  removeNodeAtPath,
  addChildAtPath,
  updateChildrenAtPath,
  moveNode,
  findNodeAtPath,
  entriesToNodes,
} from "@/workspace/model/tree-utils";
import type { FileNode } from "@/workspace/model/types";
import type { FsEntry } from "@/common/filesystem/fs-bridge";

const sampleTree: FileNode[] = [
  {
    name: "src",
    type: "folder",
    children: [
      { name: "index.ts", type: "file", size: "1k" },
      { name: "app.tsx", type: "file", size: "2k" },
      {
        name: "utils",
        type: "folder",
        children: [{ name: "helpers.ts", type: "file", size: "0.5k" }],
      },
    ],
  },
  { name: "package.json", type: "file", size: "0.8k" },
  { name: "README.md", type: "file", size: "0.3k" },
];

describe("removeNodeAtPath", () => {
  it("removes a root-level file", () => {
    const result = removeNodeAtPath(sampleTree, ["package.json"]);
    expect(result.length).toBe(2);
    expect(result.find((n) => n.name === "package.json")).toBeUndefined();
  });

  it("removes a root-level folder", () => {
    const result = removeNodeAtPath(sampleTree, ["src"]);
    expect(result.length).toBe(2);
    expect(result.find((n) => n.name === "src")).toBeUndefined();
  });

  it("removes a nested file", () => {
    const result = removeNodeAtPath(sampleTree, ["src", "index.ts"]);
    const src = result.find((n) => n.name === "src")!;
    expect(src.children!.length).toBe(2);
    expect(src.children!.find((n) => n.name === "index.ts")).toBeUndefined();
  });

  it("removes a deeply nested file", () => {
    const result = removeNodeAtPath(sampleTree, ["src", "utils", "helpers.ts"]);
    const src = result.find((n) => n.name === "src")!;
    const utils = src.children!.find((n) => n.name === "utils")!;
    expect(utils.children!.length).toBe(0);
  });

  it("returns unchanged tree for empty path", () => {
    const result = removeNodeAtPath(sampleTree, []);
    expect(result).toEqual(sampleTree);
  });

  it("returns unchanged tree for non-existent path", () => {
    const result = removeNodeAtPath(sampleTree, ["nonexistent"]);
    expect(result).toEqual(sampleTree);
  });
});

describe("addChildAtPath", () => {
  it("adds child to root", () => {
    const child: FileNode = { name: "tsconfig.json", type: "file", size: "0.2k" };
    const result = addChildAtPath(sampleTree, [], child);
    expect(result.length).toBe(4);
    expect(result.find((n) => n.name === "tsconfig.json")).toBeTruthy();
  });

  it("adds child to nested folder", () => {
    const child: FileNode = { name: "styles.css", type: "file", size: "1k" };
    const result = addChildAtPath(sampleTree, ["src"], child);
    const src = result.find((n) => n.name === "src")!;
    expect(src.children!.length).toBe(4);
    expect(src.children!.find((n) => n.name === "styles.css")).toBeTruthy();
  });

  it("adds child to deeply nested folder", () => {
    const child: FileNode = { name: "format.ts", type: "file", size: "0.3k" };
    const result = addChildAtPath(sampleTree, ["src", "utils"], child);
    const src = result.find((n) => n.name === "src")!;
    const utils = src.children!.find((n) => n.name === "utils")!;
    expect(utils.children!.length).toBe(2);
  });
});

describe("updateChildrenAtPath", () => {
  it("replaces children at root level (empty path)", () => {
    const newChildren: FileNode[] = [{ name: "only.txt", type: "file", size: "0k" }];
    const result = updateChildrenAtPath(sampleTree, [], newChildren);
    expect(result).toEqual(newChildren);
  });

  it("updates children of a nested folder", () => {
    const newChildren: FileNode[] = [{ name: "replaced.ts", type: "file", size: "0k" }];
    const result = updateChildrenAtPath(sampleTree, ["src"], newChildren);
    const src = result.find((n) => n.name === "src")!;
    expect(src.children).toEqual(newChildren);
  });
});

describe("findNodeAtPath", () => {
  it("finds a root-level node", () => {
    const node = findNodeAtPath(sampleTree, ["src"]);
    expect(node).toBeTruthy();
    expect(node!.name).toBe("src");
  });

  it("finds a nested file", () => {
    const node = findNodeAtPath(sampleTree, ["src", "index.ts"]);
    expect(node).toBeTruthy();
    expect(node!.name).toBe("index.ts");
  });

  it("finds a deeply nested file", () => {
    const node = findNodeAtPath(sampleTree, ["src", "utils", "helpers.ts"]);
    expect(node).toBeTruthy();
    expect(node!.name).toBe("helpers.ts");
  });

  it("returns null for empty path", () => {
    expect(findNodeAtPath(sampleTree, [])).toBeNull();
  });

  it("returns null for non-existent path", () => {
    expect(findNodeAtPath(sampleTree, ["nonexistent"])).toBeNull();
  });

  it("returns null for non-existent nested path", () => {
    expect(findNodeAtPath(sampleTree, ["src", "nonexistent"])).toBeNull();
  });
});

describe("moveNode", () => {
  it("moves a file to the root without losing it", () => {
    const result = moveNode(sampleTree, ["src", "index.ts"], []);
    expect(findNodeAtPath(result, ["index.ts"])).toEqual(
      findNodeAtPath(sampleTree, ["src", "index.ts"]),
    );
    expect(findNodeAtPath(result, ["src", "index.ts"])).toBeNull();
  });

  it("moves a root file into a folder without changing the input", () => {
    const result = moveNode(sampleTree, ["package.json"], ["src"]);
    expect(findNodeAtPath(result, ["src", "package.json"])).toEqual(
      findNodeAtPath(sampleTree, ["package.json"]),
    );
    expect(findNodeAtPath(result, ["package.json"])).toBeNull();
    expect(findNodeAtPath(sampleTree, ["package.json"])).not.toBeNull();
  });

  it.each([{ to: ["src"] }, { to: ["src", "utils"] }, { to: ["missing"] }, { to: ["README.md"] }])(
    "rejects an invalid folder destination $to",
    ({ to }) => {
      expect(moveNode(sampleTree, ["src"], to)).toBe(sampleTree);
    },
  );

  it("does not overwrite a destination with the same name", () => {
    const tree: FileNode[] = [
      { name: "src", type: "folder", children: [{ name: "README.md", type: "file" }] },
      ...sampleTree.slice(1),
    ];
    expect(moveNode(tree, ["README.md"], ["src"])).toBe(tree);
  });

  it("returns unchanged tree for non-existent source", () => {
    const result = moveNode(sampleTree, ["nonexistent"], ["src"]);
    expect(result).toEqual(sampleTree);
  });
});

describe("entriesToNodes", () => {
  it("filters dotfiles", () => {
    const entries: FsEntry[] = [
      { name: ".gitignore", path: "/.gitignore", isDirectory: false },
      { name: "index.ts", path: "/index.ts", isDirectory: false },
      { name: ".env", path: "/.env", isDirectory: false },
    ];
    const nodes = entriesToNodes(entries);
    expect(nodes.length).toBe(1);
    expect(nodes[0].name).toBe("index.ts");
  });

  it("sorts folders before files", () => {
    const entries: FsEntry[] = [
      { name: "zeta.ts", path: "/zeta.ts", isDirectory: false },
      { name: "alpha", path: "/alpha", isDirectory: true },
      { name: "beta.md", path: "/beta.md", isDirectory: false },
    ];
    const nodes = entriesToNodes(entries);
    expect(nodes[0].name).toBe("alpha");
    expect(nodes[0].type).toBe("folder");
  });

  it("sorts files alphabetically within same type", () => {
    const entries: FsEntry[] = [
      { name: "z.ts", path: "/z.ts", isDirectory: false },
      { name: "a.ts", path: "/a.ts", isDirectory: false },
    ];
    const nodes = entriesToNodes(entries);
    expect(nodes[0].name).toBe("a.ts");
    expect(nodes[1].name).toBe("z.ts");
  });

  it("creates folder nodes with empty children", () => {
    const entries: FsEntry[] = [{ name: "src", path: "/src", isDirectory: true }];
    const nodes = entriesToNodes(entries);
    expect(nodes[0].type).toBe("folder");
    expect(nodes[0].children).toEqual([]);
  });

  it("creates file nodes with empty size string", () => {
    const entries: FsEntry[] = [{ name: "index.ts", path: "/index.ts", isDirectory: false }];
    const nodes = entriesToNodes(entries);
    expect(nodes[0].type).toBe("file");
    expect(nodes[0].size).toBe("");
  });
});
