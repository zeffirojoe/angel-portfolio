import Image from "next/image";
import { getPortfolio } from "@/lib/instagram";
import { featuredPermalinks, site } from "@/lib/site";
import { Gallery, Stories } from "./Gallery";

const InstagramLink = ({ children, className = "btn btn-outline" }: { children: React.ReactNode; className?: string }) => (
  <a className={className} href={site.instagramUrl} target="_blank" rel="noreferrer">
    {children}
  </a>
);

function Embeds() {
  return (
    <>
      <ul className="embeds">
        {featuredPermalinks.map((url) => (
          <li key={url}>
            <iframe
              src={`${url}embed/`}
              title="Tattoo post by Angel on Instagram"
              loading="lazy"
              allowTransparency
              sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            />
          </li>
        ))}
      </ul>
      <InstagramLink>See all work on Instagram</InstagramLink>
    </>
  );
}

export async function Work() {
  const portfolio = await getPortfolio();
  if (portfolio.media.length === 0) {
    return (
      <div data-portfolio-status="fallback">
        {featuredPermalinks.length > 0 ? (
          <Embeds />
        ) : (
          <div className="notice">
            <p>The gallery is taking a moment to load. Angel&rsquo;s latest work is always on Instagram.</p>
            <InstagramLink>Visit @{site.handle}</InstagramLink>
          </div>
        )}
      </div>
    );
  }
  return (
    <div data-portfolio-status={portfolio.status}>
      {portfolio.stories.length > 0 && <Stories items={portfolio.stories} />}
      <Gallery items={portfolio.media} />
      <InstagramLink>See all work on Instagram</InstagramLink>
    </div>
  );
}

const count = (n: number) => n.toLocaleString("en-US");

export async function Artist() {
  const { profile } = await getPortfolio();
  const stats = [
    profile?.posts != null && `${count(profile.posts)} posts`,
    profile?.followers != null && `${count(profile.followers)} followers`,
  ].filter(Boolean);
  return (
    <div className="artist">
      <div className="artist-photo">
        {profile?.pictureUrl ? (
          <Image
            src={profile.pictureUrl}
            alt="Portrait of Angel"
            fill
            sizes="176px"
            quality={80}
            unoptimized={!/\.(cdninstagram\.com|fbcdn\.net)\//.test(profile.pictureUrl)}
          />
        ) : (
          <span aria-hidden="true">A</span>
        )}
      </div>
      <div>
        <p className="eyebrow">The artist</p>
        <h2 className="section-title" id="about-title">
          Small details, <em>a steady hand.</em>
        </h2>
        {profile?.biography ? (
          <p className="lede artist-bio">{profile.biography}</p>
        ) : (
        <p className="lede">
          Angel tattoos in {site.location}, working in fine line and black and grey realism: soft shading, crisp
          edges and subjects that range from florals to everyday objects with personal meaning.
        </p>
        )}
        <p className="artist-meta">
          <InstagramLink className="text-link">@{profile?.username ?? site.handle}</InstagramLink>
          {stats.length > 0 && <span> · {stats.join(" · ")}</span>}
        </p>
      </div>
    </div>
  );
}

export function WorkSkeleton() {
  return (
    <div role="status" aria-label="Loading recent work">
      <ul className="gallery" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i}>
            <div className="thumb thumb-skeleton" />
          </li>
        ))}
      </ul>
    </div>
  );
}
