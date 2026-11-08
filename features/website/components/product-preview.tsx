"use client";

import { ArrowRightIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

const previews = [
	{
		id: "pages",
		label: "Pages",
		src: "/guides/images/workspace.webp",
		width: 2400,
		height: 1440,
		alt: "Haunter workspace with connected pages, a weekly plan, and tasks beside the notes.",
		caption: "A thought becomes a page. A page becomes a plan.",
	},
	{
		id: "tasks",
		label: "Tasks",
		src: "/guides/images/tasks.webp",
		width: 1540,
		height: 770,
		alt: "Haunter task list bringing together workshop tasks, their source pages, assignees, and due dates.",
		caption: "All your next steps, without losing where they came from.",
	},
	{
		id: "canvases",
		label: "Canvases",
		src: "/guides/images/inline-canvas.webp",
		width: 1540,
		height: 972,
		alt: "A canvas inside a Haunter page, sketching the flow of a community workshop.",
		caption: "Some ideas make more sense when you draw them.",
	},
] as const;

export function ProductPreview() {
	const [selected, setSelected] = useState(0);
	const preview = previews[selected];

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-base sm:text-sm">
				<p className="text-muted-foreground">A look inside Haunter</p>
				<fieldset className="flex gap-1">
					<legend className="sr-only">Choose a product preview</legend>
					{previews.map((item, index) => (
						<button
							key={item.id}
							type="button"
							aria-pressed={selected === index}
							aria-controls="product-preview"
							onClick={() => setSelected(index)}
							className="min-h-12 rounded-lg px-3 font-medium text-muted-foreground outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-foreground/10 aria-pressed:text-foreground"
						>
							{item.label}
						</button>
					))}
				</fieldset>
			</div>
			<figure id="product-preview" className="flex flex-col gap-5">
				<a
					href={preview.src}
					target="_blank"
					rel="noreferrer"
					aria-label={`View full-size ${preview.label.toLowerCase()} screenshot (opens in a new tab)`}
					className="flex aspect-5/3 items-center overflow-hidden rounded-[min(2vw,1rem)] bg-[#282a36] outline-1 -outline-offset-1 outline-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
				>
					<Image
						key={preview.id}
						src={preview.src}
						alt={preview.alt}
						width={preview.width}
						height={preview.height}
						preload={selected === 0}
						sizes="(max-width: 1280px) 100vw, 1216px"
						className="max-h-full w-full object-contain"
					/>
				</a>
				<figcaption
					aria-live="polite"
					className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-pretty text-base text-muted-foreground sm:text-sm"
				>
					<span>{preview.caption}</span>
					<Link
						href={`/guides/${preview.id}`}
						className="inline-flex min-h-11 items-center gap-2 rounded-lg font-medium text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
					>
						{preview.label} in the Handbook{" "}
						<ArrowRightIcon aria-hidden className="size-4" />
					</Link>
				</figcaption>
			</figure>
		</div>
	);
}
