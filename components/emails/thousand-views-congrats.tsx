import React from "react";

import {
  Body,
  Head,
  Html,
  Link,
  Preview,
  Tailwind,
  Text,
} from "react-email";

interface ThousandViewsCongratsEmailProps {
  name: string | null | undefined;
}

const ThousandViewsCongratsEmail = ({
  name,
}: ThousandViewsCongratsEmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>1000 views on Papermark.</Preview>
      <Tailwind>
        <Body className="font-sans text-sm">
          <Text>Hi{name && ` ${name}`},</Text>
          <Text>
            I&apos;m Marc, founder of Papermark. Congrats on 1000 views on your
            documents.
          </Text>
          <Text>How is your experience so far?</Text>

          <Text>
            Thanks so much,
            <br />
            Marc
          </Text>
          <Text>
            <Link
              href="https://www.g2.com/products/papermark/reviews"
              target="_blank"
              className="text-blue-500 underline"
              rel="noopener noreferrer"
            >
              Leave us a G2 review
            </Link>
          </Text>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default ThousandViewsCongratsEmail;
