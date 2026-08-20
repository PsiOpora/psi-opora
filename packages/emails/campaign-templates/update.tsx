import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Html,
	Preview,
	Section,
	Tailwind,
	Text,
} from "@react-email/components";

import { emailTailwindConfig } from "../tailwind";

export default function UpdateEmail({
	heading = "",
	intro = "",
	highlightTitle = "",
	highlightBody = "",
	buttonText = "",
	buttonUrl = "",
}: Record<string, string>) {
	const introParagraphs = intro.split(/\n{2,}/).filter(Boolean);
	const highlightParagraphs = highlightBody.split(/\n{2,}/).filter(Boolean);
	const hasButton = Boolean(buttonText && buttonUrl);

	return (
		<Html>
			<Head />
			<Preview>{heading}</Preview>
			<Tailwind config={emailTailwindConfig}>
				<Body className="mx-auto my-auto bg-white font-sans">
					<Container className="mx-auto my-[40px] w-[465px] rounded border border-solid border-[#eaeaea] p-[20px]">
						<Heading className="mx-0 my-[30px] p-0 text-center text-[24px] font-normal text-black">
							{heading}
						</Heading>
						{introParagraphs.map((paragraph) => (
							<Text
								key={paragraph}
								className="whitespace-pre-line text-[14px] leading-[24px] text-black"
							>
								{paragraph}
							</Text>
						))}
						{(highlightTitle || highlightParagraphs.length > 0) && (
							<Section className="my-[24px] rounded border border-solid border-[#eaeaea] bg-[#fafafa] p-[16px]">
								{highlightTitle && (
									<Text className="mb-[8px] mt-0 text-[16px] font-semibold text-black">
										{highlightTitle}
									</Text>
								)}
								{highlightParagraphs.map((paragraph) => (
									<Text
										key={paragraph}
										className="whitespace-pre-line text-[14px] leading-[24px] text-black"
									>
										{paragraph}
									</Text>
								))}
							</Section>
						)}
						{hasButton && (
							<Section className="mb-[16px] mt-[32px] text-center">
								<Button
									className="rounded bg-[#000000] px-5 py-3 text-center text-[14px] font-semibold text-white no-underline"
									href={buttonUrl}
								>
									{buttonText}
								</Button>
							</Section>
						)}
					</Container>
				</Body>
			</Tailwind>
		</Html>
	);
}
