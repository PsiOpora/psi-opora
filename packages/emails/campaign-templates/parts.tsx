import { Hr, Img, Link, Section, Text } from "@react-email/components";

/**
 * Картинка письма. Ширина фиксирована атрибутом (465px — ширина контейнера
 * шаблонов): Outlook игнорирует CSS-ширину и иначе растягивает картинку до
 * её натурального размера.
 */
export function CampaignImage({
	src,
	alt,
	href,
}: {
	src?: string;
	alt?: string;
	href?: string;
}) {
	if (!src) return null;
	const image = (
		<Img
			src={src}
			alt={alt ?? ""}
			width="465"
			className="mx-auto my-0 block h-auto w-full max-w-full rounded"
		/>
	);
	return (
		<Section className="my-[16px]">
			{href ? <Link href={href}>{image}</Link> : image}
		</Section>
	);
}

/**
 * Обязательный футер рассылки со ссылкой отписки. {{unsubscribe_url}}
 * подставляется при отправке: персональной ссылкой на нашу страницу отписки
 * (Rusender) или тегом {{UnsubscribeUrl}} Unisender.
 */
export function CampaignFooter() {
	return (
		<>
			<Hr className="mx-0 my-[24px] w-full border border-solid border-[#eaeaea]" />
			<Text className="m-0 text-center text-[12px] leading-[20px] text-[#666666]">
				Вы получили это письмо, потому что ваш адрес есть в нашей базе рассылки.{" "}
				<Link href="{{unsubscribe_url}}" className="text-[#666666] underline">
					Отписаться
				</Link>
			</Text>
		</>
	);
}
