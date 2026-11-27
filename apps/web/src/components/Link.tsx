import {
  createContext,
  useContext,
  type AnchorHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { Icon } from './icons/Icon';
import styles from './Link.module.css';

/** What an in-app link receives: anchor attributes with a required `href`, and a ref. */
export type LinkComponentProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  ref?: Ref<HTMLAnchorElement> | undefined;
};

/** Renders an in-app link. The app shell supplies one that wraps React Router's link. */
export type RenderLink = (props: LinkComponentProps) => ReactElement;

const renderAnchor: RenderLink = (props) => <a {...props} />;

const LinkContext = createContext<RenderLink>(renderAnchor);

/**
 * Supplies how in-app links render. The app shell passes a function that returns React Router's
 * link, so links navigate inside the single-page app; without a provider they are plain anchors,
 * which is what the gallery uses.
 */
export function LinkProvider({ render, children }: { render: RenderLink; children: ReactNode }) {
  return <LinkContext value={render}>{children}</LinkContext>;
}

export type LinkProps = LinkComponentProps & {
  /** A link out of FlagOps (Flagsmith, GitHub). It opens in a new tab and says so. */
  external?: boolean;
};

/** Every link FlagOps renders goes through this component. */
export function Link({ external = false, children, ...props }: LinkProps) {
  const render = useContext(LinkContext);
  if (external) {
    return (
      <a {...props} target="_blank" rel="noopener noreferrer">
        {children}
        <Icon name="external" className={styles.icon} />
        <span className="visually-hidden"> (opens in a new tab)</span>
      </a>
    );
  }
  return render({ ...props, children });
}
