import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { BlockNoteBlock } from "@/lib/types";
import { Json } from "@/lib/types/database.types";
import { v4 as uuidv4 } from "uuid";
import { useCanvasScroll } from "@/lib/hooks/useCanvasScroll";

export function useBlockPromotion(streamId: string) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { setTargetBlockId } = useCanvasScroll();

  const promoteBlock = useMutation({
    mutationFn: async ({
      block,
      entryId,
    }: {
      block: BlockNoteBlock;
      entryId: string;
    }) => {
      // Fetch current canvas
      const { data: canvas, error: fetchError } = await supabase
        .from("canvases")
        .select("*")
        .eq("stream_id", streamId)
        .single();

      if (fetchError) throw fetchError;

      // Create promoted block with metadata
      const promotedBlockId = uuidv4();
      const promotedBlock: BlockNoteBlock = {
        ...block,
        id: promotedBlockId,
        props: {
          ...block.props,
          promoted_from_entry_id: entryId,
          promoted_at: new Date().toISOString(),
        },
      };

      // Append to canvas
      // Cast content_json to array of blocks
      const currentContent =
        (canvas.content_json as unknown as BlockNoteBlock[]) || [];
      const updatedContent = [...currentContent, promotedBlock];

      // Update canvas
      const { error: updateError } = await supabase
        .from("canvases")
        .update({ content_json: updatedContent as unknown as Json }) // Cast back to Json
        .eq("id", canvas.id);

      if (updateError) throw updateError;

      return { promotedBlock, canvasId: canvas.id, promotedBlockId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["canvas", streamId] });
      // Trigger auto-scroll to the new block
      setTargetBlockId(data.promotedBlockId);
    },
  });

  return { promoteBlock };
}
