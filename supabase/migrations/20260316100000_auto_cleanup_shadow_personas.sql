-- Auto-delete unused shadow personas when their last reference is removed

create or replace function public.cleanup_unused_shadow_persona(p_persona_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  if p_persona_id is null then
    return;
  end if;

  delete from public.personas p
  where p.id = p_persona_id
    and p.is_shadow = true
    and not exists (
      select 1
      from public.sections s
      where s.persona_id = p_persona_id
    )
    and not exists (
      select 1
      from public.section_pdf_attachments a
      where a.referenced_persona_id = p_persona_id
    );
end;
$$;

create or replace function public.cleanup_shadow_persona_from_sections()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.persona_id is distinct from old.persona_id then
      perform public.cleanup_unused_shadow_persona(old.persona_id);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.cleanup_unused_shadow_persona(old.persona_id);
    return old;
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.cleanup_shadow_persona_from_attachments()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.referenced_persona_id is distinct from old.referenced_persona_id then
      perform public.cleanup_unused_shadow_persona(old.referenced_persona_id);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.cleanup_unused_shadow_persona(old.referenced_persona_id);
    return old;
  end if;

  return coalesce(new, old);
end;
$$;

-- Sections -> cleanup when persona_id is removed or changed
DROP TRIGGER IF EXISTS trg_cleanup_shadow_persona_sections ON public.sections;
create trigger trg_cleanup_shadow_persona_sections
after update of persona_id or delete on public.sections
for each row execute function public.cleanup_shadow_persona_from_sections();

-- Attachments -> cleanup when referenced_persona_id is removed or changed
DROP TRIGGER IF EXISTS trg_cleanup_shadow_persona_attachments ON public.section_pdf_attachments;
create trigger trg_cleanup_shadow_persona_attachments
after update of referenced_persona_id or delete on public.section_pdf_attachments
for each row execute function public.cleanup_shadow_persona_from_attachments();
