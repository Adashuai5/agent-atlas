import crypto from "node:crypto";
import path from "node:path";
import type { Atlas } from "./scan.ts";
import type { Binding, Diagnosis, Installation, RuntimeConsumer } from "./model.ts";

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}:${crypto.createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 20)}`;
}

function normalizedExposedName(binding: Binding, installation: Installation): string {
  const name = path.basename(binding.viaPath) || installation.name;
  return name.replace(/\.md$/i, "").trim().toLowerCase();
}

function applicableBindings(atlas: Atlas, selectedProjectPath?: string | null): Binding[] {
  if (selectedProjectPath === undefined) return atlas.bindings;
  const consumers = new Map(atlas.consumers.map((consumer) => [consumer.id, consumer]));
  return atlas.bindings.filter((binding) => {
    const consumer = consumers.get(binding.consumerId);
    if (!consumer) return false;
    if (consumer.scope === "global") return true;
    return selectedProjectPath !== null && consumer.projectPath === selectedProjectPath;
  });
}

function diagnosis(input: Omit<Diagnosis, "id">): Diagnosis {
  return {
    ...input,
    id: stableId(
      `diagnosis-${input.kind}`,
      input.consumerId ?? "all",
      ...input.installationIds.slice().sort(),
      ...input.bindingIds.slice().sort()
    )
  };
}

function evidenceFor(installations: Installation[], bindings: Binding[]): string[] {
  return [...new Set([
    ...installations.flatMap((installation) => installation.evidenceIds),
    ...bindings.flatMap((binding) => binding.evidenceIds)
  ])];
}

function canonicalIds(installations: Installation[]): string[] {
  return [...new Set(installations.map((installation) => installation.canonicalSourceId).filter((id): id is string => Boolean(id)))];
}

/**
 * Diagnose relationships only from physical/content identity and explicit
 * runtime bindings. Same-name resources in different runtimes are never a
 * conflict merely because their contents differ.
 */
export function evaluateDiagnoses(atlas: Atlas, selectedProjectPath?: string | null): Diagnosis[] {
  const diagnoses: Diagnosis[] = [];
  const bindings = applicableBindings(atlas, selectedProjectPath);
  const bindingByInstallation = new Map<string, Binding[]>();
  const installationById = new Map(atlas.installations.map((installation) => [installation.id, installation]));
  const consumerById = new Map(atlas.consumers.map((consumer) => [consumer.id, consumer]));
  for (const binding of bindings) {
    const group = bindingByInstallation.get(binding.installationId) ?? [];
    group.push(binding);
    bindingByInstallation.set(binding.installationId, group);
  }

  for (const installation of atlas.installations) {
    const relatedBindings = bindingByInstallation.get(installation.id) ?? [];
    const locationApplies = selectedProjectPath === undefined
      || installation.locations.some((location) => location.scope === "global" || (selectedProjectPath !== null && location.projectPath === selectedProjectPath));
    if (!locationApplies) continue;
    if (installation.locations.length > 1) {
      diagnoses.push(diagnosis({
        kind: "alias",
        severity: "healthy",
        confidence: "confirmed",
        consumerId: relatedBindings.length === 1 ? relatedBindings[0].consumerId : null,
        canonicalSourceIds: canonicalIds([installation]),
        installationIds: [installation.id],
        bindingIds: relatedBindings.map((binding) => binding.id),
        pluginPackageIds: installation.pluginPackageId ? [installation.pluginPackageId] : [],
        title: `${installation.name} 的 ${installation.locations.length} 个路径是同一物理资源`,
        titleEn: `${installation.locations.length} paths for ${installation.name} resolve to one physical resource`,
        detail: "realpath 或 device/inode 一致；这些路径是 alias，不是冲突或冗余副本。",
        detailEn: "The realpath or device/inode identity matches. These paths are aliases, not conflicting or redundant copies.",
        action: "无需处理；保留路径关系即可。",
        actionEn: "No action is needed; keep the path relationship intact.",
        evidenceIds: evidenceFor([installation], relatedBindings)
      }));
    }
    if (installation.present.value === true && installation.valid.value === false) {
      diagnoses.push(diagnosis({
        kind: "invalid",
        severity: "attention",
        confidence: "confirmed",
        consumerId: relatedBindings.length === 1 ? relatedBindings[0].consumerId : null,
        canonicalSourceIds: canonicalIds([installation]),
        installationIds: [installation.id],
        bindingIds: relatedBindings.map((binding) => binding.id),
        pluginPackageIds: installation.pluginPackageId ? [installation.pluginPackageId] : [],
        title: `${installation.name} 存在但结构无效`,
        titleEn: `${installation.name} is present but invalid`,
        detail: "路径存在，但目标不可达或缺少该资源类型要求的结构。",
        detailEn: "The path exists, but its target is unavailable or its required resource structure is missing.",
        action: "检查链接目标和必需文件；Atlas 不会自动修改它。",
        actionEn: "Inspect the link target and required files; Atlas will not modify it automatically.",
        evidenceIds: evidenceFor([installation], relatedBindings)
      }));
    }
  }

  const installationsByCanonical = new Map<string, Installation[]>();
  for (const installation of atlas.installations) {
    if (!installation.canonicalSourceId) continue;
    const group = installationsByCanonical.get(installation.canonicalSourceId) ?? [];
    group.push(installation);
    installationsByCanonical.set(installation.canonicalSourceId, group);
  }
  for (const [canonicalSourceId, group] of installationsByCanonical) {
    if (group.length < 2) continue;
    const relevant = group.filter((installation) => bindingByInstallation.has(installation.id));
    const runtimes = new Set(relevant.flatMap((installation) => (bindingByInstallation.get(installation.id) ?? [])
      .map((binding) => consumerById.get(binding.consumerId)?.runtime)
      .filter(Boolean)));
    const hashes = new Set(relevant.map((installation) => installation.contentHash).filter(Boolean));
    if (relevant.length < 2 || runtimes.size < 2 || relevant.some((installation) => !installation.contentHash) || hashes.size !== 1) continue;
    const relatedBindings = relevant.flatMap((installation) => bindingByInstallation.get(installation.id) ?? []);
    diagnoses.push(diagnosis({
      kind: "mirror",
      severity: "info",
      confidence: "confirmed",
      consumerId: null,
      canonicalSourceIds: [canonicalSourceId],
      installationIds: relevant.map((installation) => installation.id),
      bindingIds: relatedBindings.map((binding) => binding.id),
      pluginPackageIds: [...new Set(relevant.map((installation) => installation.pluginPackageId).filter((id): id is string => Boolean(id)))],
      title: `${group[0].name} 在 ${runtimes.size} 个运行时中是内容一致的镜像`,
      titleEn: `${group[0].name} is a content-identical mirror across ${runtimes.size} runtimes`,
      detail: "物理安装不同，但标准化内容 hash 一致，且分别绑定到不同运行时；这只证明镜像关系，不证明实际加载。",
      detailEn: "The physical installations differ, but their normalized hashes match and they are bound to different runtimes. This proves a mirror relationship, not actual loading.",
      action: "无需合并或删除；仅在维护成本成为问题时再评估来源。",
      actionEn: "Do not merge or delete them automatically; revisit only if maintenance cost becomes material.",
      evidenceIds: evidenceFor(relevant, relatedBindings)
    }));
  }

  const visible = bindings.filter((binding) => {
    const installation = installationById.get(binding.installationId);
    return binding.enabled.value !== false && binding.visibility === "visible" && installation?.valid.value !== false;
  });
  const runtimeGroups = new Map<string, { runtime: RuntimeConsumer["runtime"]; bindings: Binding[] }>();
  for (const binding of visible) {
    const consumer = consumerById.get(binding.consumerId);
    const installation = installationById.get(binding.installationId);
    if (!consumer || !installation) continue;
    const consumerGrouping = selectedProjectPath === undefined ? consumer.id : consumer.runtime;
    const key = `${consumerGrouping}:${installation.type}:${normalizedExposedName(binding, installation)}`;
    const group = runtimeGroups.get(key) ?? { runtime: consumer.runtime, bindings: [] };
    group.bindings.push(binding);
    runtimeGroups.set(key, group);
  }

  for (const group of runtimeGroups.values()) {
    // Project-local/default precedence is a cascade, not simultaneous loading.
    // Diagnose only bindings at the highest visible priority in this scope.
    const highestPriority = Math.max(...group.bindings.map((binding) => binding.priority ?? 0));
    const activeBindings = group.bindings.filter((binding) => (binding.priority ?? 0) === highestPriority);
    const installationIds = [...new Set(activeBindings.map((binding) => binding.installationId))];
    if (installationIds.length < 2) continue;
    const installations = installationIds.map((id) => installationById.get(id)).filter((item): item is Installation => Boolean(item));
    const hashes = new Set(installations.map((installation) => installation.contentHash).filter((hash): hash is string => Boolean(hash)));
    const consumers = [...new Set(activeBindings.map((binding) => binding.consumerId))];
    const common = {
      consumerId: consumers.length === 1 ? consumers[0] : null,
      canonicalSourceIds: canonicalIds(installations),
      installationIds,
      bindingIds: activeBindings.map((binding) => binding.id),
      pluginPackageIds: [...new Set(installations.map((installation) => installation.pluginPackageId).filter((id): id is string => Boolean(id)))],
      evidenceIds: evidenceFor(installations, activeBindings)
    };
    const name = installations[0].name;
    if (hashes.size === 1 && installations.every((installation) => installation.contentHash)) {
      if (activeBindings.every((binding) => binding.loaded.value === true)) {
        diagnoses.push(diagnosis({
          ...common,
          kind: "redundant",
          severity: "attention",
          confidence: "confirmed",
          title: `${group.runtime} 重复加载了 ${name} 的多个内容一致安装`,
          titleEn: `${group.runtime} loaded multiple content-identical installations of ${name}`,
          detail: "同一运行时的多个 loaded=true 绑定指向不同物理安装，但标准化内容 hash 一致。",
          detailEn: "Multiple loaded=true bindings in one runtime point to distinct physical installations with the same normalized hash.",
          action: "确认运行时搜索优先级；在保留可回滚路径的前提下评估冗余。",
          actionEn: "Confirm runtime search precedence and assess redundancy while keeping a rollback path.",
        }));
      } else {
        diagnoses.push(diagnosis({
          ...common,
          kind: "uncertain",
          severity: "info",
          confidence: "unknown",
          title: `${group.runtime} 可见 ${name} 的多个内容一致安装，但重复加载未确认`,
          titleEn: `${group.runtime} can see multiple identical installations of ${name}, but duplicate loading is unconfirmed`,
          detail: "标准化内容 hash 一致，但至少一个 binding 缺少 loaded=true 证据，因此不判为 redundant。",
          detailEn: "Normalized hashes match, but at least one binding lacks loaded=true evidence, so Atlas does not classify it as redundant.",
          action: "保留现状，等待 runtime/session 加载证据。",
          actionEn: "Keep the current state and wait for runtime or session loading evidence.",
        }));
      }
    } else if (hashes.size > 1 && installations.every((installation) => installation.contentHash)) {
      diagnoses.push(diagnosis({
        ...common,
        kind: "conflict",
        severity: "warning",
        confidence: "confirmed",
        title: `${group.runtime} 可见 ${name} 的内容分叉`,
        titleEn: `${group.runtime} can see divergent content for ${name}`,
        detail: "同一运行时资源面可见多个同名 binding，且标准化内容 hash 不同；这不代表它们已实际加载。",
        detailEn: "Multiple same-name bindings are visible on one runtime's resource surface with different normalized content hashes; this does not mean they were actually loaded.",
        action: "先核验运行时优先级和实际加载关系，再决定是否调整；Atlas 不会自动修改资源。",
        actionEn: "Verify runtime precedence and actual loading before changing anything; Atlas will not modify resources automatically.",
      }));
    } else {
      diagnoses.push(diagnosis({
        ...common,
        kind: "uncertain",
        severity: "info",
        confidence: "unknown",
        title: `${group.runtime} 的同名资源缺少完整内容证据`,
        titleEn: `Same-name resources for ${group.runtime} lack complete content evidence`,
        detail: "至少一个安装无法取得标准化 hash，因此不能判定为镜像、冗余或冲突。",
        detailEn: "At least one installation lacks a normalized hash, so Atlas cannot classify the relationship as mirror, redundant, or conflict.",
        action: "修复读取权限或目标路径后重新扫描。",
        actionEn: "Fix read access or the target path, then scan again.",
      }));
    }
  }

  const severityRank = { warning: 0, attention: 1, info: 2, healthy: 3 } as const;
  return diagnoses.sort((left, right) => severityRank[left.severity] - severityRank[right.severity] || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
}
