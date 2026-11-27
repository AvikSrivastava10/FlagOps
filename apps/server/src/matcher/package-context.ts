import { posix } from 'node:path';
import { productsOfPackage, type Product } from './sdk-modules.js';

/**
 * Package context (architecture.md 8.3): the SDKs a file's package uses, read from the nearest
 * `package.json` and every ancestor up to the repository root, so monorepos that declare their
 * dependencies at the root are covered.
 */
export type PackageContext = { productsOf(file: string): ReadonlySet<Product> };

type Manifest = {
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
};

function dependencyNames(text: string): string[] {
  let manifest: Manifest;
  try {
    manifest = JSON.parse(text) as Manifest;
  } catch {
    return [];
  }
  return [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies].flatMap(
    (section) => (typeof section === 'object' && section !== null ? Object.keys(section) : []),
  );
}

/** `manifests` maps each `package.json` path, repository-relative, to its text. */
export function createPackageContext(manifests: ReadonlyMap<string, string>): PackageContext {
  const productsByDirectory = new Map<string, Product[]>();
  for (const [path, text] of manifests) {
    const directory = posix.dirname(path);
    productsByDirectory.set(
      directory === '.' ? '' : directory,
      dependencyNames(text).flatMap(productsOfPackage),
    );
  }
  const cache = new Map<string, ReadonlySet<Product>>();
  return {
    productsOf(file) {
      let directory = posix.dirname(file);
      directory = directory === '.' ? '' : directory;
      const cached = cache.get(directory);
      if (cached !== undefined) {
        return cached;
      }
      const products = new Set<Product>();
      for (let current = directory; ; current = posix.dirname(current)) {
        const key = current === '.' ? '' : current;
        for (const product of productsByDirectory.get(key) ?? []) {
          products.add(product);
        }
        if (key === '') {
          break;
        }
      }
      cache.set(directory, products);
      return products;
    },
  };
}
