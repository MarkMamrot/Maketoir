using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;

if (args.Length != 1)
{
    Console.Error.WriteLine("Usage: validator <docx-path>");
    return 2;
}

using var document = WordprocessingDocument.Open(args[0], false);
var errors = new OpenXmlValidator().Validate(document).ToList();

Console.WriteLine($"Validation errors: {errors.Count}");
foreach (var error in errors.Take(50))
{
    Console.WriteLine($"{error.ErrorType}: {error.Description}");
    Console.WriteLine($"Path: {error.Path?.XPath}");
    Console.WriteLine($"Part: {error.Part?.Uri}");
}

return errors.Count == 0 ? 0 : 1;