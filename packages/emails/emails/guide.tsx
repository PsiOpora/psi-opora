import { APP_CONFIG } from "@psi-opora/config";
import {
	Body,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Preview,
	Tailwind,
	Text,
} from "@react-email/components";

import { emailTailwindConfig } from "../tailwind";

export default function GuideEmail({
	subject = "Ваш гайд",
	body = "",
}: {
	subject: string;
	body: string;
}) {
	const paragraphs = body.split(/\n{2,}/).filter(Boolean);

	return (
		<Html>
			<Head />
			<Preview>{subject}</Preview>
			<Tailwind config={emailTailwindConfig}>
				<Body className="mx-auto my-auto bg-white font-sans">
					<Container className="mx-auto my-[40px] w-[465px] rounded border border-solid border-[#eaeaea] p-[20px]">
						<Heading className="mx-0 my-[30px] p-0 text-center text-[20px] font-normal text-black">
							{APP_CONFIG.shortName}
						</Heading>
						{paragraphs.map((paragraph) => (
							<Text
								key={paragraph}
								className="whitespace-pre-line text-[14px] leading-[24px] text-black"
							>
								{paragraph}
							</Text>
						))}
						<Hr className="mx-0 my-[26px] w-full border border-solid border-[#eaeaea]" />
						<Text className="text-[12px] leading-[24px] text-[#666666]">
							Гайд приложен к письму PDF-файлом.
						</Text>
					</Container>
				</Body>
			</Tailwind>
		</Html>
	);
}
