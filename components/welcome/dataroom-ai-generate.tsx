import { useRouter } from "next/router";
import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { FolderIcon, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { mutate } from "swr";

import { useAnalytics } from "@/lib/analytics";
import { STAGGER_CHILD_VARIANTS } from "@/lib/constants";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

export default function DataroomAIGenerate({
  dataroomId,
}: {
  dataroomId?: string;
}) {
  const router = useRouter();
  const teamInfo = useTeam();
  const analytics = useAnalytics();
  
  const [aiDescription, setAiDescription] = useState<string>("");
  const [aiGenerating, setAiGenerating] = useState<boolean>(false);
  const [generatedFolders, setGeneratedFolders] = useState<any[] | null>(null);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [dataroomName, setDataroomName] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedFolderPaths, setSelectedFolderPaths] = useState<Set<string>>(
    new Set(),
  );
  const [editingFolderPath, setEditingFolderPath] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState<string>("");

  // Generate a unique path for each folder
  const generateFolderPath = (folder: any, parentPath: string = ""): string => {
    const currentPath = parentPath ? `${parentPath}/${folder.name}` : folder.name;
    return currentPath;
  };

  // Initialize all folders as selected when preview is shown
  const initializeFolderSelection = (folders: any[], parentPath: string = "") => {
    const paths = new Set<string>();
    const collectPaths = (f: any[], currentPath: string = "") => {
      f.forEach((folder) => {
        const folderPath = generateFolderPath(folder, currentPath);
        paths.add(folderPath);
        if (folder.subfolders) {
          collectPaths(folder.subfolders, folderPath);
        }
      });
    };
    collectPaths(folders);
    setSelectedFolderPaths(paths);
  };

  // Toggle folder selection
  const toggleFolderSelection = (path: string, folder: any) => {
    const newSelected = new Set(selectedFolderPaths);
    
    if (newSelected.has(path)) {
      newSelected.delete(path);
      const removeSubfolders = (f: any, currentPath: string) => {
        if (f.subfolders) {
          f.subfolders.forEach((sub: any) => {
            const subPath = generateFolderPath(sub, currentPath);
            newSelected.delete(subPath);
            removeSubfolders(sub, subPath);
          });
        }
      };
      removeSubfolders(folder, path);
    } else {
      newSelected.add(path);
    }
    
    setSelectedFolderPaths(newSelected);
  };

  // Filter folders based on selection
  const filterSelectedFolders = (folders: any[], parentPath: string = ""): any[] => {
    return folders
      .map((folder) => {
        const currentPath = generateFolderPath(folder, parentPath);
        const isSelected = selectedFolderPaths.has(currentPath);
        
        if (!isSelected) {
          return null;
        }
        
        const filteredSubfolders = folder.subfolders
          ? filterSelectedFolders(folder.subfolders, currentPath)
          : undefined;
        
        return {
          ...folder,
          subfolders: filteredSubfolders && filteredSubfolders.length > 0 
            ? filteredSubfolders 
            : undefined,
        };
      })
      .filter((folder) => folder !== null);
  };

  // Update folder name in the folder structure
  const updateFolderName = (
    folders: any[],
    targetPath: string,
    newName: string,
    currentPath: string = "",
  ): any[] => {
    return folders.map((folder) => {
      const folderPath = generateFolderPath(folder, currentPath);
      
      if (folderPath === targetPath) {
        return { ...folder, name: newName };
      }
      
      if (folder.subfolders && folder.subfolders.length > 0) {
        return {
          ...folder,
          subfolders: updateFolderName(
            folder.subfolders,
            targetPath,
            newName,
            folderPath,
          ),
        };
      }
      
      return folder;
    });
  };

  // Handle folder name edit
  const handleFolderNameEdit = (path: string, currentName: string) => {
    setEditingFolderPath(path);
    setEditingFolderName(currentName);
  };

  // Save edited folder name
  const saveFolderName = () => {
    if (!editingFolderPath || !generatedFolders) return;
    
    if (editingFolderName.trim()) {
      const updatedFolders = updateFolderName(
        generatedFolders,
        editingFolderPath,
        editingFolderName.trim(),
      );
      setGeneratedFolders(updatedFolders);
      initializeFolderSelection(updatedFolders);
    }
    
    setEditingFolderPath(null);
    setEditingFolderName("");
  };

  // Cancel editing
  const cancelFolderNameEdit = () => {
    setEditingFolderPath(null);
    setEditingFolderName("");
  };

  const handleGenerateFolders = async () => {
    if (!aiDescription.trim()) {
      return toast.error("Please describe what kind of dataroom you want to create.");
    }

    setAiGenerating(true);

    try {
      const response = await fetch(
        `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/generate-ai-structure`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            description: aiDescription.trim(),
          }),
        },
      );

      if (!response.ok) {
        const { message } = await response.json();
        setAiGenerating(false);
        toast.error(message || "Failed to generate folder structure");
        return;
      }

      const { name, folders } = await response.json();
      setGeneratedFolders(folders);
      if (name) {
        setDataroomName(name);
      }
      initializeFolderSelection(folders);
      setShowPreview(true);
      setAiGenerating(false);
    } catch (error) {
      setAiGenerating(false);
      toast.error("Error generating folder structure. Please try again.");
    }
  };

  const handleCreateDataroom = async () => {
    if (!dataroomName.trim()) {
      return toast.error("Please provide a dataroom name.");
    }

    if (dataroomName.trim().length < 3) {
      return toast.error(
        "Please provide a dataroom name with at least 3 characters.",
      );
    }

    if (!generatedFolders) return;

    if (!teamInfo?.currentTeam?.id) {
      return toast.error("Team not found. Please refresh the page and try again.");
    }

    const filteredFolders = filterSelectedFolders(generatedFolders);
    
    if (filteredFolders.length === 0) {
      return toast.error("Please select at least one folder to include.");
    }

    setLoading(true);
    try {
      const response = await fetch(
        `/api/teams/${teamInfo.currentTeam.id}/datarooms/generate-ai`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: dataroomName.trim(),
            folders: filteredFolders,
            ...(dataroomId && { dataroomId }),
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.message || errorData.error || "Error creating dataroom. Please try again.";
        setLoading(false);
        toast.error(errorMessage);
        return;
      }

      const { dataroom } = await response.json();

      analytics.capture("Dataroom Generated with AI", {
        dataroomName: dataroomName.trim(),
      });

      mutate(`/api/teams/${teamInfo?.currentTeam?.id}/datarooms`);
      mutate(`/api/teams/${teamInfo?.currentTeam?.id}/datarooms?simple=true`);
      toast.success("Dataroom successfully generated! 🎉");
      router.push(`/datarooms/${dataroom.id}/documents`);
    } catch (error) {
      setLoading(false);
      toast.error("Error creating dataroom. Please try again.");
    }
  };

  const renderFolderPreview = (
    folders: any[],
    indent = 0,
    parentPath: string = "",
  ) => {
    return (
      <div className="space-y-1">
        {folders.map((folder, index) => {
          const currentPath = generateFolderPath(folder, parentPath);
          const isSelected = selectedFolderPaths.has(currentPath);
          
          return (
            <div key={`${parentPath}-${index}`} className="pl-4">
              <div className="flex items-center gap-2 py-1">
                <div
                  className="h-4 w-4"
                  style={{ marginLeft: `${indent * 16}px` }}
                />
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleFolderSelection(currentPath, folder)}
                  id={`folder-${currentPath}`}
                />
                <label
                  htmlFor={`folder-${currentPath}`}
                  className="flex items-center gap-2 cursor-pointer flex-1"
                >
                  <FolderIcon className="h-4 w-4 text-gray-500" />
                  {editingFolderPath === currentPath ? (
                    <Input
                      value={editingFolderName}
                      onChange={(e) => setEditingFolderName(e.target.value)}
                      onBlur={saveFolderName}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveFolderName();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelFolderNameEdit();
                        }
                      }}
                      className="h-6 text-sm px-2 py-1"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="text-sm hover:bg-gray-100 dark:hover:bg-gray-800 px-1 py-0.5 rounded cursor-text"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFolderNameEdit(currentPath, folder.name);
                      }}
                      title="Click to edit folder name"
                    >
                      {folder.name}
                    </span>
                  )}
                </label>
              </div>
              {folder.subfolders && folder.subfolders.length > 0 && (
                <div className="ml-4">
                  {renderFolderPreview(folder.subfolders, indent + 1, currentPath)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <motion.div
      className="z-10 flex flex-col space-y-10 text-center"
      variants={{
        hidden: { opacity: 0, scale: 0.95 },
        show: {
          opacity: 1,
          scale: 1,
          transition: {
            staggerChildren: 0.2,
          },
        },
      }}
      initial="hidden"
      animate="show"
      exit="hidden"
      transition={{ duration: 0.3, type: "spring" }}
    >
      <motion.div
        variants={STAGGER_CHILD_VARIANTS}
        className="flex flex-col items-center space-y-10 text-center"
      >
        <h1 className="font-display text-balance text-3xl font-semibold text-foreground transition-colors sm:text-4xl">
          Generate dataroom with AI
        </h1>
      
      </motion.div>

      <motion.div variants={STAGGER_CHILD_VARIANTS}>
        <main className="mx-auto mt-8 max-w-md w-full px-4 sm:px-0">
          <div className="space-y-6">
        {!showPreview ? (
          <>
            <div className="space-y-2 text-left">
              <Label htmlFor="ai-description" className="text-base">
                Describe your dataroom in details{" "}
                <span className="text-black dark:text-white">*</span>
              </Label>
              <Textarea
                id="ai-description"
                placeholder="A data room for a Series B fundraising round for a AI startup called 'Acme AI'. Create advanced data room with IP information and financials."
                value={aiDescription}
                onChange={(e) => setAiDescription(e.target.value)}
                rows={4}
                className="resize-none"
              />
            </div>
            <div className="space-y-2">
              <Button
                onClick={handleGenerateFolders}
                loading={aiGenerating}
                disabled={!aiDescription.trim() || aiGenerating}
                className="w-full"
                size="lg"
              >
                Generate data room structure
              </Button>
              {aiGenerating && (
                <p className="text-center text-xs text-muted-foreground">
                  Generation can take up to 60 seconds
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2 text-left">
              <Label htmlFor="dataroom-name-ai" className="text-base">
                Dataroom Name{" "}
                <span className="text-black dark:text-white">*</span>
              </Label>
              <Input
                id="dataroom-name-ai"
                placeholder="AI Generated Data Room"
                value={dataroomName}
                onChange={(e) => setDataroomName(e.target.value)}
                required
                className="text-base"
              />
            </div>
            <div className="space-y-2 text-left">
              <Label className="text-base">
                Generated Folder Structure{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  (Select folders to include)
                </span>
              </Label>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={
                    generatedFolders &&
                    selectedFolderPaths.size > 0 &&
                    generatedFolders.every((folder) => {
                      const path = generateFolderPath(folder);
                      return selectedFolderPaths.has(path);
                    })
                      ? true
                      : false
                  }
                  onCheckedChange={(checked) => {
                    if (checked && generatedFolders) {
                      initializeFolderSelection(generatedFolders);
                    } else {
                      setSelectedFolderPaths(new Set());
                    }
                  }}
                  id="select-all"
                />
                <label
                  htmlFor="select-all"
                  className="cursor-pointer"
                >
                  Select/Deselect All
                </label>
              </div>
              <div className="max-h-96 overflow-y-auto rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
                {generatedFolders && renderFolderPreview(generatedFolders)}
              </div>
            </div>
            <Button
              onClick={handleCreateDataroom}
              loading={loading}
              className="w-full"
              size="lg"
            >
              Create Dataroom
            </Button>
          </>
        )}
          </div>
        </main>
      </motion.div>
    </motion.div>
  );
}

