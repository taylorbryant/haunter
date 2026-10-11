import { Children, isValidElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import { helpHeadingId } from "../guides";

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
