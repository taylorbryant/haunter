import { Children, isValidElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import { helpHeadingId } from "../guides";

const screenshotSizes: Record<string, { width: number; height: number }> = {
	"/guides/images/workspace.webp": { width: 2400, height: 1440 },
	"/guides/images/block-menu.webp": { width: 560, height: 830 },
	"/guides/images/tasks.webp": { width: 1540, height: 770 },
	"/guides/images/inline-canvas.webp": { width: 1540, height: 972 },
};

function plainText(children: ReactNode): string {
	return Children.toArray(children)
		.map((child): string => {
			if (typeof child === "string" || typeof child === "number")
				return String(child);
			if (isValidElement<{ children?: ReactNode }>(child))
				return plainText(child.props.children);
			return "";
		})
		.join("");
}

export function HelpMarkdown({ children }: { children: string }) {
	return (
		<div className="help-prose max-w-[70ch]">
			<Markdown
				skipHtml
				components={{
					p: ({ children, node }) => {
						const image = node?.children.length === 1 ? node.children[0] : null;
						if (image?.type === "element" && image.tagName === "img") {
							const { src, alt, title } = image.properties;
							const size =
								typeof src === "string" ? screenshotSizes[src] : null;
							if (typeof src === "string" && size) {
								return (
									<figure>
										<a
											href={src}
											target="_blank"
											rel="noopener noreferrer"
											aria-label={`Open full-size screenshot in a new tab: ${alt ?? "Haunter"}`}
											title="Open full-size screenshot in a new tab"
											style={{ maxWidth: size.width / 2 }}
										>
											<img
												src={src}
												alt={typeof alt === "string" ? alt : ""}
												width={size.width}
												height={size.height}
												loading="lazy"
												decoding="async"
											/>
										</a>
										<figcaption>
											{typeof title === "string" && <>{title} </>}
											<a href={src} target="_blank" rel="noopener noreferrer">
												View full size
												<span className="sr-only"> (opens in a new tab)</span>
											</a>
										</figcaption>
									</figure>
								);
							}
						}
						return <p>{children}</p>;
					},
					h2: ({ children }) => (
						<h2 id={helpHeadingId(plainText(children))}>{children}</h2>
					),
				}}
			>
				{children}
			</Markdown>
		</div>
	);
}
